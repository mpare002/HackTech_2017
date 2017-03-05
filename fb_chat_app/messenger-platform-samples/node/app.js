/*
 * Copyright 2016-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the
 * LICENSE file in the root directory of this source tree.
 *

Config
{
    "appSecret": "1",
    "pageAccessToken": "<changes frequently>",
    "validationToken": "1",
    "serverURL": "localhost"
}


User requests to be connected to other user. 
User chats to bot, to chat with other user

Special cmds:
  "$username:" string after this specifies my username
  "$connect-to" string after this specifies username of who i want to connect to



 */

/* jshint node: true, devel: true */
'use strict';

/* make sure to get all these with npm */
const 
  bodyParser = require('body-parser'),
  config = require('config'),
  crypto = require('crypto'),
  express = require('express'),
  https = require('https'),  
  request = require('request');

var app = express();
app.set('port', process.env.PORT || 5000);
app.set('view engine', 'ejs');
app.use(bodyParser.json({ verify: verifyRequestSignature }));
app.use(express.static('public'));


/* For managing current users and who they are connected to */
var username_to_userid = {}; // user_name -> user_id
var userid_to_username = {}; // user_id -> user_name
// todo; is there a bettter way to do this ^ ?!?!?!
var conversations = {}; // user_name -> user_name


// 1 is true
var pizza_mode = 0;


// first, last, email, phoneNumber, streetAddress, state, zip, cardNum
// 0       1       2      3              4            5      6   7 
var pizza_data_entry_state = 0; // enum hahah
global.temp_first = "";
var temp_last = "";
var temp_email = "";
var temp_phone = "";
var temp_street = "";
var temp_state = "";
var temp_zip = "";
var temp_cardNum = "";




// Connect to mongoDB
var MongoClient = require('mongodb').MongoClient;
// Connect to the db
MongoClient.connect("mongodb://localhost:27017/hacktech", function(err, db) {
  if(!err) {
    console.log("We are connected to mongoDB");
  }
  else {
    console.log("Can't connect to mongoDB!!!");
  }

  db.close()
});


/*
 * Be sure to setup your config values before running this code. You can 
 * set them using environment variables or modifying the config file in /config.
 *
 */

// App Secret can be retrieved from the App Dashboard
const APP_SECRET = (process.env.MESSENGER_APP_SECRET) ? 
  process.env.MESSENGER_APP_SECRET :
  config.get('appSecret');

// Arbitrary value used to validate a webhook
const VALIDATION_TOKEN = (process.env.MESSENGER_VALIDATION_TOKEN) ?
  (process.env.MESSENGER_VALIDATION_TOKEN) :
  config.get('validationToken');

// Generate a page access token for your page from the App Dashboard
const PAGE_ACCESS_TOKEN = (process.env.MESSENGER_PAGE_ACCESS_TOKEN) ?
  (process.env.MESSENGER_PAGE_ACCESS_TOKEN) :
  config.get('pageAccessToken');

// URL where the app is running (include protocol). Used to point to scripts and 
// assets located at this address. 
const SERVER_URL = (process.env.SERVER_URL) ?
  (process.env.SERVER_URL) :
  config.get('serverURL');

if (!(APP_SECRET && VALIDATION_TOKEN && PAGE_ACCESS_TOKEN && SERVER_URL)) {
  console.error("Missing config values");
  process.exit(1);
}

/*
 * Use your own validation token. Check that the token used in the Webhook 
 * setup is the same token used here.
 *
 */
app.get('/webhook', function(req, res) {
  if (req.query['hub.mode'] === 'subscribe' &&
      req.query['hub.verify_token'] === VALIDATION_TOKEN) {
    console.log("Validating webhook");
    res.status(200).send(req.query['hub.challenge']);
  } else {
    console.error("Failed validation. Make sure the validation tokens match.");
    res.sendStatus(403);          
  }  
});


/*
 * All callbacks for Messenger are POST-ed. They will be sent to the same
 * webhook. Be sure to subscribe your app to your page to receive callbacks
 * for your page. 
 * https://developers.facebook.com/docs/messenger-platform/product-overview/setup#subscribe_app
 *
 */
app.post('/webhook', function (req, res) {
  var data = req.body;

  // Make sure this is a page subscription
  if (data.object == 'page') {
    // Iterate over each entry
    // There may be multiple if batched
    data.entry.forEach(function(pageEntry) {
      var pageID = pageEntry.id;
      var timeOfEvent = pageEntry.time;

      // Iterate over each messaging event
      pageEntry.messaging.forEach(function(messagingEvent) {
        if (messagingEvent.optin) {
          receivedAuthentication(messagingEvent);
        } else if (messagingEvent.message) {
          receivedMessage(messagingEvent);
        } else if (messagingEvent.delivery) {
          receivedDeliveryConfirmation(messagingEvent);
        } else if (messagingEvent.postback) {
          receivedPostback(messagingEvent);
        } else if (messagingEvent.read) {
          receivedMessageRead(messagingEvent);
        } else if (messagingEvent.account_linking) {
          receivedAccountLink(messagingEvent);
        } else {
          console.log("Webhook received unknown messagingEvent: ", messagingEvent);
        }
      });
    });

    // Assume all went well.
    //
    // You must send back a 200, within 20 seconds, to let us know you've 
    // successfully received the callback. Otherwise, the request will time out.
    res.sendStatus(200);
  }
});

/*
 * This path is used for account linking. The account linking call-to-action
 * (sendAccountLinking) is pointed to this URL. 
 * 
 */
app.get('/authorize', function(req, res) {
  var accountLinkingToken = req.query.account_linking_token;
  var redirectURI = req.query.redirect_uri;

  // Authorization Code should be generated per user by the developer. This will 
  // be passed to the Account Linking callback.
  var authCode = "1234567890";

  // Redirect users to this URI on successful login
  var redirectURISuccess = redirectURI + "&authorization_code=" + authCode;

  res.render('authorize', {
    accountLinkingToken: accountLinkingToken,
    redirectURI: redirectURI,
    redirectURISuccess: redirectURISuccess
  });
});


app.get('/test', function(req, res) {


  res.send("Hello there");

});


app.get('/privacy', function(req, res) {
  res.send("I don't think I store any of your personal information.");

});

/*
 * Verify that the callback came from Facebook. Using the App Secret from 
 * the App Dashboard, we can verify the signature that is sent with each 
 * callback in the x-hub-signature field, located in the header.
 *
 * https://developers.facebook.com/docs/graph-api/webhooks#setup
 *
 */
function verifyRequestSignature(req, res, buf) {
  var signature = req.headers["x-hub-signature"];

  if (!signature) {
    // For testing, let's log an error. In production, you should throw an 
    // error.
    console.error("Couldn't validate the signature.");
  } else {
    var elements = signature.split('=');
    var method = elements[0];
    var signatureHash = elements[1];

    var expectedHash = crypto.createHmac('sha1', APP_SECRET)
                        .update(buf)
                        .digest('hex');

    if (signatureHash != expectedHash) {
      throw new Error("Couldn't validate the request signature.");
    }
  }
}

/*
 * Authorization Event
 *
 * The value for 'optin.ref' is defined in the entry point. For the "Send to 
 * Messenger" plugin, it is the 'data-ref' field. Read more at 
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/authentication
 *
 */
function receivedAuthentication(event) {
  var senderID = event.sender.id;
  var recipientID = event.recipient.id;
  var timeOfAuth = event.timestamp;

  // The 'ref' field is set in the 'Send to Messenger' plugin, in the 'data-ref'
  // The developer can set this to an arbitrary value to associate the 
  // authentication callback with the 'Send to Messenger' click event. This is
  // a way to do account linking when the user clicks the 'Send to Messenger' 
  // plugin.
  var passThroughParam = event.optin.ref;

  console.log("Received authentication for user %d and page %d with pass " +
    "through param '%s' at %d", senderID, recipientID, passThroughParam, 
    timeOfAuth);

  // When an authentication is received, we'll send a message back to the sender
  // to let them know it was successful.
  sendTextMessage(senderID, "Authentication successful");
}

/*
 * Message Event
 *
 * This event is called when a message is sent to your page. The 'message' 
 * object format can vary depending on the kind of message that was received.
 * Read more at https://developers.facebook.com/docs/messenger-platform/webhook-reference/message-received
 *
 * For this example, we're going to echo any text that we get. If we get some 
 * special keywords ('button', 'generic', 'receipt'), then we'll send back
 * examples of those bubbles to illustrate the special message bubbles we've 
 * created. If we receive a message with an attachment (image, video, audio), 
 * then we'll simply confirm that we've received the attachment.
 * 
 */
function receivedMessage(event) {

  console.log("\n-----------------\n-----------------\n-----------------\n-----------------\nfish YOU MOTHERfishER!!!!!!!\n-----------------\n-----------------\n-----------------\n-----------------\n");

  console.log("\nevent 'object' \n");
  console.log(event);
  console.log("\n\n");

  var senderID = event.sender.id;
  var recipientID = event.recipient.id;
  var timeOfMessage = event.timestamp;
  var message = event.message;

  console.log("Received message for user %d and page %d at %d with message:", 
    senderID, recipientID, timeOfMessage);
  console.log(JSON.stringify(message));


  var isEcho = message.is_echo;
  var messageId = message.mid;
  var appId = message.app_id;
  var metadata = message.metadata;



  // You may get a text or attachment but not both
  var messageText = message.text;
  var messageAttachments = message.attachments;
  var quickReply = message.quick_reply;

  if (isEcho) {
    // Just logging message echoes to console
    console.log("Received echo for message %s and app %d with metadata %s", 
      messageId, appId, metadata);
    return;
  } else if (quickReply) {
    var quickReplyPayload = quickReply.payload;
    console.log("Quick reply for message %s with payload %s",
      messageId, quickReplyPayload);

    sendTextMessage(senderID, "Quick reply tapped");
    return;
  }

  if (messageText) {

    // If we receive a text message, check to see if it matches any special
    // keywords and send back the corresponding example. Otherwise, just echo
    // the text we received.
    switch (messageText) {
      case 'image':
        sendImageMessage(senderID);
        break;

      case 'gif':
        sendGifMessage(senderID);
        break;

      case 'audio':
        sendAudioMessage(senderID);
        break;

      case 'video':
        sendVideoMessage(senderID);
        break;

      case 'file':
        sendFileMessage(senderID);
        break;

      case 'button':
        sendButtonMessage(senderID);
        break;

      case 'generic':
        sendGenericMessage(senderID);
        break;

      case 'receipt':
        sendReceiptMessage(senderID);
        break;

      case 'quick reply':
        sendQuickReply(senderID);
        break;        

      case 'read receipt':
        sendReadReceipt(senderID);
        break;        

      case 'typing on':
        sendTypingOn(senderID);
        break;        

      case 'typing off':
        sendTypingOff(senderID);
        break;        

      case 'account linking':
        sendAccountLinking(senderID);
        break;

      default:

        // check because this function was being called twice automatically
        if(messageText == "") {
          break;
        }



        console.log("\n\n-------------\nHandling text message(probably):");
        console.log(messageText);

// first, last, email, phoneNumber, streetAddress, state, zip, cardNum
// 0       1       2      3              4            5      6   7 
// var pizza_data_entry_state = 0; // enum hahah
/*
var temp_first = "";
var temp_last = "";
var temp_email = "";
var temp_phone = "";
var temp_street = "";
var temp_state = "";
var temp_zip = "";
var temp_cardNum = "";
*/        
        if(messageText.substring(0,6) == "dbdump") {
          // todo; print all shit from DB
        }

        if(pizza_mode == 1) {
          console.log("pizza mode (0 or 1): ", pizza_mode);

          if(pizza_data_entry_state == 0) {
            console.log("pizza0");
            console.log(messageText);

            temp_first = messageText;

            console.log(temp_first);

            var next_req = "Ok " +  temp_first + ", what's your last name?";
            sendTextMessage(senderID, next_req);
            pizza_data_entry_state = pizza_data_entry_state + 1;
          }
          else if(pizza_data_entry_state == 1) {
            temp_last = messageText;
            var next_req = "Ok " + temp_first +" " +  temp_last + " what's your email?";
            sendTextMessage(senderID, next_req);
            pizza_data_entry_state = pizza_data_entry_state + 1;

          }
          else if(pizza_data_entry_state == 2) {
            temp_email = messageText;
            var next_req = "Ok " + temp_first + " what's your phone number? (numbers only)";
            sendTextMessage(senderID, next_req);
            pizza_data_entry_state = pizza_data_entry_state + 1;

          }
          else if(pizza_data_entry_state == 3) {
            temp_phone = messageText;
            var next_req = "Ok " + temp_first  + " what's your street address?";
            sendTextMessage(senderID, next_req);
            pizza_data_entry_state = pizza_data_entry_state + 1;

          }
          else if(pizza_data_entry_state == 4) {
            temp_street = messageText;
            var next_req = "Ok " + temp_first + " what state do you live in? eg: CA, AK, MI, ...";
            sendTextMessage(senderID, next_req);
            pizza_data_entry_state = pizza_data_entry_state + 1;

          }
          else if(pizza_data_entry_state == 5) {
            temp_state = messageText;
            var next_req = "Ok " + temp_first  + " what's your 5 digit zip code?";
            sendTextMessage(senderID, next_req);
            pizza_data_entry_state = pizza_data_entry_state + 1;

          }
          else if(pizza_data_entry_state == 6) {
            temp_zip = messageText;
            var next_req = "Ok " + temp_first  + " what's your credit card number?";
            sendTextMessage(senderID, next_req);
            pizza_data_entry_state = pizza_data_entry_state + 1;

          }
          else if(pizza_data_entry_state == 7) {
            temp_cardNum = messageText;

            var pizza_str = temp_first+"\n"+temp_last+"\n"+temp_email+"\n"+temp_phone+"\n"+temp_street+"\n"+temp_state+"\n"+temp_zip+"\n"+temp_cardNum+"\n";


            var next_req = "wow, I can't believe you gave me your credit card info...\n attempting to order you a pepperoni pizza.\n\nThis is the info you entered:\n"+pizza_str;
            sendTextMessage(senderID, next_req);
            pizza_data_entry_state = 0;
            pizza_mode = 0;


            console.log("------\nWRITE to FILE\n-------");


            console.log("pizza info:\n", pizza_str);


            var fs = require('fs');
            fs.writeFileSync("../../../dominos_bot/pizza_order.txt", pizza_str ); 



            console.log("------\nRUN SCRIPT\n-------");

            var exec = require('child_process').exec, child456;

            child456 = exec('python ../../../dominos_bot/create_user_get_menu.py',
                function (error, stdout, stderr) {
                    console.log('stdout: ' + stdout);
                    console.log('stderr: ' + stderr);
                    if (error !== null) {
                         console.log('exec error: ' + error);
                    }
                });


            // send message to user with the result (stored in ../../../dominos_bot/pizza_order.txt)
            var pizza_order_status = String(fs.readFileSync("../../../dominos_bot/pizza_order.txt", "utf8"));

            console.log("pizza order status", pizza_order_status);

            // python script might not be done before readFileSync is called!?!?! 
            while(pizza_order_status.substring(0,7) != "<pizza>") {

              console.log("pizza script not done");

              // keep reading the file until it begins with: <pizza>
              // <pizza> is only written with the python script is done, or has fucked up
              pizza_order_status = String(fs.readFileSync("../../../dominos_bot/pizza_order.txt", "utf8"));

            }

            // this sould make messages get sent in order
            setTimeout(function() {
                sendTextMessage(senderID, pizza_order_status.substring(7));
            }, 2000);

            // sendTextMessage(senderID, pizza_order_status.substring(7));


            // todo
            // send text to number with twilio: stating that pizza has been ordered
            var accountSid = 'ACe522a5fb7f2809a1fbb32bc84c102484'; 
            var authToken = '168d783b3ebef33d955c96a341331dbd'; 
             
            //require the Twilio module and create a REST client 
            var client = require('twilio')(accountSid, authToken); 
             
            client.messages.create({ 
                to: temp_phone, 
                from: "+15087795637", 
                body: "This is Jeff the Pizza Man(bot)! Your pizza may or may not have been ordered...", 
            }, function(err, message) { 
                console.log(message); 
            });

          }
// +15087795637 

        }

        else if(messageText.substring(0,5) == "pizza") {
          pizza_mode = 1;
          console.log("Pizza mode activated");





          // the collection/table: db.userInfo

          // var matching_user = 0;


          // TODO: fish javascript!
          // MongoClient.connect("mongodb://localhost:27017/hacktech", function(err, db) {
          //   if(!err) {
          //     console.log("We are connected to mongoDB 666");

          //     var collection = db.collection( 'userInfo' );

          //     var matching_user = collection.find({"senderId" : {$exists:true} ,"senderID": senderID}).toArray();
          //     console.log("database select called. result is...");
          //     console.log(matching_user.length);


          //   }
          //   else {
          //     console.log("Can't connect to mongoDB!!!");
          //   }

          //   db.close()
          // });



          // todo: implement with database
          // if(matching_user.length == 0) {
          if(true) {
            sendTextMessage(senderID, "PIZZA TIME!\n\nTo get started, let's get some of your personal info!\n\nPlease don't enter erronious information. I am currently not sophisticated enough to update user records. #hacktech\n\nStart by entering your first name.");

          }
          else if(matching_user.length == 1) {
            var first = matching_user[0][first];

            var mesg = "Welcome back " + first;
            sendTextMessage(senderID, mesg);

            // Todo implement
          }
          else {
            // WTF?!
            // should not happen
          }


          // sendTextMessage(senderID, "");


        }

        // user can see who they are connected to
        else if(messageText.substring(0,10) == "$cur-conn:") {
          // check if user has created a username
          if(senderID in userid_to_username) {
            if(userid_to_username[senderID] in conversations) {
              var partner = String(conversations[userid_to_username[senderID]]);
              var ret_str = "You are currently connected to " + partner;
              sendTextMessage(senderID, ret_str);
            }
            else {

            }
          }
          else {
            sendTextMessage(senderID, "You are not currently connected to anyone.");
          }
        }

        // print all available facebook users
        else if(messageText.substring(0,12) == "$users-dump:") {
          var users_string = "Current Users:\n";

          for(var user in username_to_userid) {
            users_string += String(user);
            users_string += "\n";
          }

          sendTextMessage(senderID, users_string);
        }

        // Create a new user name- notice: it is copied below... should encapsulate
        else if(messageText.substring(0,10) == "$username:") {
          console.log("$username:");

          var username = messageText.substring(10);

          if(username in username_to_userid) {
            console.log("The username ", username, " already exists motherfisher");
            var error_string = "The username" + username + "already exists!";
            sendTextMessage(senderID, error_string);
          }
          // this person already has a username
          else if(senderID in userid_to_username) {
            sendTextMessage(senderID, "Hello?! You already have a username. (no redos!)");
          }
          else {
            username_to_userid[username] = senderID;
            userid_to_username[senderID] = username;
            console.log("username of ", senderID, " set to:", username);
            var success_string = "Ok, hello " + username;
            sendTextMessage(senderID, success_string);
          }

        }
        // another syntax for creating username - woo hoo copy pasteing code!
        else if(messageText.substring(0,5) == "I am " || messageText.substring(0,5) == "i am ") {
          console.log("I am");

          var username = messageText.substring(5);

          if(username in username_to_userid) {
            console.log("The username", username, "already exists motherfisher");
            var error_string = "The username" + username + "already exists!";
            sendTextMessage(senderID, error_string);
          }
          // this person already has a username
          else if(senderID in userid_to_username) {
            sendTextMessage(senderID, "Hello?! You already have a username. (no redos!)");
          }
          else {
            username_to_userid[username] = senderID;
            userid_to_username[senderID] = username;
            console.log("username of", senderID, "set to:", username);
            var success_string = "Ok, hello " + username;
            sendTextMessage(senderID, success_string);
          }
        }

        // Create a connection to another  person
        else if(messageText.substring(0,12) == "$connect-to:") {
          console.log("$connect-to:");

          // Should be able to better fit this into the if-else logic below...
          var legal_connection = true;
          if(senderID in userid_to_username) {
            if(userid_to_username[senderID] in conversations) {
              // you are already in a conversation. Switching without disconnecting 
              // would fuck up the stored data.
              legal_connection = false;
              sendTextMessage(senderID, "Please disconnect from you current conversation before attempting to message with someone else. ");
            }
          }
          else {
            legal_connection = false;
            sendTextMessage(senderID, "Choose a username before attempting to connect with other users." );
          }

          var username_to_connect = messageText.substring(12);

          if(username_to_connect in username_to_userid) {

            // the person u trying to connect to is in conversaion
            if(username_to_connect in conversations) {
              var tfti_string = username_to_connect + " is already planning a pizza party with someone else... ouch";
              sendTextMessage(senderID, tfti_string);
            }
            else if(legal_connection) {
              var me_username = userid_to_username[senderID];

              conversations[me_username] = username_to_connect;
              conversations[username_to_connect] = me_username;

              var success_string = "You are now connected to " + username_to_connect;
              sendTextMessage(senderID, success_string);
            }

          }
          else {
            var error_string = "fish you, the person you are trying to connnect to:" + username_to_connect + "does not exists";
            sendTextMessage(senderID, error_string);
          }
        }
        // alternate syntax to Create a connection to another  person
        else if(messageText.substring(0,11) == "connect to ") {
          console.log("connect to");

          // Should be able to better fit this into the if-else logic below...
          var legal_connection = true;
          if(senderID in userid_to_username) {
            if(userid_to_username[senderID] in conversations) {
              // you are already in a conversation. Switching without disconnecting 
              // would fuck up the stored data.
              legal_connection = false;
              sendTextMessage(senderID, "Please disconnect from you current conversation before attempting to message with someone else. ");
            }
          }
          else {
            legal_connection = false;
            sendTextMessage(senderID, "Choose a username before attempting to connect with other users." );
          }

          var username_to_connect = messageText.substring(11);

          if(username_to_connect in username_to_userid) {

            // the person u trying to connect to is in conversaion
            if(username_to_connect in conversations) {
              var tfti_string = username_to_connect + " is already planning a pizza party with someone else... ouch";
              sendTextMessage(senderID, tfti_string);
            }
            else if(legal_connection) {
              var me_username = userid_to_username[senderID];

              conversations[me_username] = username_to_connect;
              conversations[username_to_connect] = me_username;

              var success_string = "You are now connected to " + username_to_connect;
              sendTextMessage(senderID, success_string);
            }

          }
          else {
            var error_string = "fish you, the person you are trying to connnect to:" + username_to_connect + "does not exists";
            sendTextMessage(senderID, error_string);
          }
        }


        else if(messageText.substring(0,10) == "disconnect" || messageText.substring(0,13) == "disconnect me") {
          var username = String(userid_to_username[senderID]);
          if(username in conversations) {
            var partner = conversations[username];
            delete conversations[username];
            delete conversations[partner];
            var del_str = "Ok, you are no longer speaking with " + partner;
            sendTextMessage(senderID, del_str);
          }
          else {
            sendTextMessage(senderID, "You are not in a conversation and therefore cannot be disconnected.");
          }
        }

        else if(messageText == '$info-dump:') {
          var u1 = "username_to_userid:\n"
          for(var username in username_to_userid) {
            u1 += username;
            u1 += ' : ';
            u1 += username_to_userid[username];
            u1 += '\n';
          }
          var u2 = "\nuserid_to_username:\n"
          for(var userid in userid_to_username) {
            u2 += userid;
            u2 += ' : ';
            u2 += userid_to_username[userid];
            u2 += '\n';
          }
          var cn = "\nconversations:\n"
          for(var user in conversations) {
            cn += user;
            cn += ' : ';
            cn += conversations[user];
            cn += '\n';
          }

          var info_str =  u1 + u2 + cn;

          sendTextMessage(senderID, info_str);
        }

        // This is a normal message sent:
        else {
          console.log("other type of message ");

          // If username not defined: send back generic help message
          if(!(senderID in userid_to_username)) {

            console.log("senderID not in userid_to_username");

            var help_string = "Hello! I am Jeff, professional pizza party planner - at " +
                              "your service. To set up a pizza party planning chat with " + 
                              "another facebook messenger " +
                              "user, type the following prompts: "+
                              "\n\n$username:<your desired username>" +
                              "\n$connect-to:<username of who you want to connect to>" +
                              "\n   -or-" +
                              "\n 'i am <username>' and 'connect to <username>'" +
                              "\n\n\nto see a list of registered users you can chat with type:" +
                              "\n\n$users-dump:" +
                              "\n\n\nto disconnect: type 'disconnect'" +
                              "\n\n\nTo see who you are currently in conversation with, type:" +
                              "\n\n$cur-conn:" +
                              "\n\n\nWhen you have finished planning your party, you can " +
                              "order your pizzas by simply typing: 'pizza' ";

            sendTextMessage(senderID, help_string);
          }
          // If this person is not connected to anyone
          else if(!(userid_to_username[senderID] in conversations)) {

            console.log("senderID's username not in conversations ");

            var help_string = "You need to connect to another user:\n$connect-to:<username of who you want to connect to>";
            sendTextMessage(senderID, help_string);
          }
          // fishit idk why im checking both conditions again.
          else if((senderID in userid_to_username) && (userid_to_username[senderID] in conversations)) {

            console.log("the motherfisher should be connected to someone else rn. ");

            var poop = conversations[userid_to_username[senderID]];
            var send_to_id = username_to_userid[poop];
            var message_snt = userid_to_username[senderID] + " says: " + messageText;
            sendTextMessage(send_to_id, message_snt);

            // sendTextMessage("ethan.lo.714", "OMG!!");

            
          }
          // This case should never happen..
          else {
            sendTextMessage(senderID, "what the fish is going on dawg?!?!??!");
          }

        }


        // sendTextMessage(senderID, messageText);
    }
  } else if (messageAttachments) {
    sendTextMessage(senderID, "Message with attachment received");
  }
}


/*
 * Delivery Confirmation Event
 *
 * This event is sent to confirm the delivery of a message. Read more about 
 * these fields at https://developers.facebook.com/docs/messenger-platform/webhook-reference/message-delivered
 *
 */
function receivedDeliveryConfirmation(event) {
  var senderID = event.sender.id;
  var recipientID = event.recipient.id;
  var delivery = event.delivery;
  var messageIDs = delivery.mids;
  var watermark = delivery.watermark;
  var sequenceNumber = delivery.seq;

  if (messageIDs) {
    messageIDs.forEach(function(messageID) {
      console.log("Received delivery confirmation for message ID: %s", 
        messageID);
    });
  }

  console.log("All message before %d were delivered.", watermark);
}


/*
 * Postback Event
 *
 * This event is called when a postback is tapped on a Structured Message. 
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/postback-received
 * 
 */
function receivedPostback(event) {
  var senderID = event.sender.id;
  var recipientID = event.recipient.id;
  var timeOfPostback = event.timestamp;

  // The 'payload' param is a developer-defined field which is set in a postback 
  // button for Structured Messages. 
  var payload = event.postback.payload;

  console.log("Received postback for user %d and page %d with payload '%s' " + 
    "at %d", senderID, recipientID, payload, timeOfPostback);

  // When a postback is called, we'll send a message back to the sender to 
  // let them know it was successful
  sendTextMessage(senderID, "Postback called");
}

/*
 * Message Read Event
 *
 * This event is called when a previously-sent message has been read.
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/message-read
 * 
 */
function receivedMessageRead(event) {
  var senderID = event.sender.id;
  var recipientID = event.recipient.id;

  // All messages before watermark (a timestamp) or sequence have been seen.
  var watermark = event.read.watermark;
  var sequenceNumber = event.read.seq;

  console.log("Received message read event for watermark %d and sequence " +
    "number %d", watermark, sequenceNumber);
}

/*
 * Account Link Event
 *
 * This event is called when the Link Account or UnLink Account action has been
 * tapped.
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/account-linking
 * 
 */
function receivedAccountLink(event) {
  var senderID = event.sender.id;
  var recipientID = event.recipient.id;

  var status = event.account_linking.status;
  var authCode = event.account_linking.authorization_code;

  console.log("Received account link event with for user %d with status %s " +
    "and auth code %s ", senderID, status, authCode);
}

/*
 * Send an image using the Send API.
 *
 */
function sendImageMessage(recipientId) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      attachment: {
        type: "image",
        payload: {
          url: SERVER_URL + "/assets/rift.png"
        }
      }
    }
  };

  callSendAPI(messageData);
}

/*
 * Send a Gif using the Send API.
 *
 */
function sendGifMessage(recipientId) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      attachment: {
        type: "image",
        payload: {
          url: SERVER_URL + "/assets/instagram_logo.gif"
        }
      }
    }
  };

  callSendAPI(messageData);
}

/*
 * Send audio using the Send API.
 *
 */
function sendAudioMessage(recipientId) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      attachment: {
        type: "audio",
        payload: {
          url: SERVER_URL + "/assets/sample.mp3"
        }
      }
    }
  };

  callSendAPI(messageData);
}

/*
 * Send a video using the Send API.
 *
 */
function sendVideoMessage(recipientId) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      attachment: {
        type: "video",
        payload: {
          url: SERVER_URL + "/assets/allofus480.mov"
        }
      }
    }
  };

  callSendAPI(messageData);
}

/*
 * Send a file using the Send API.
 *
 */
function sendFileMessage(recipientId) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      attachment: {
        type: "file",
        payload: {
          url: SERVER_URL + "/assets/test.txt"
        }
      }
    }
  };

  callSendAPI(messageData);
}

/*
 * Send a text message using the Send API.
 *
 */
function sendTextMessage(recipientId, messageText) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      text: messageText,
      metadata: "DEVELOPER_DEFINED_METADATA"
    }
  };

  callSendAPI(messageData);

  // // messages were being sent out of order. idk if this fixes it but probably.....?!!?!?!?!?!?... didnt work
  // setTimeout(function(){/* Look mah! No name! */},3000);

}

/*
 * Send a button message using the Send API.
 *
 */
function sendButtonMessage(recipientId) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      attachment: {
        type: "template",
        payload: {
          template_type: "button",
          text: "This is test text",
          buttons:[{
            type: "web_url",
            url: "https://www.oculus.com/en-us/rift/",
            title: "Open Web URL"
          }, {
            type: "postback",
            title: "Trigger Postback",
            payload: "DEVELOPER_DEFINED_PAYLOAD"
          }, {
            type: "phone_number",
            title: "Call Phone Number",
            payload: "+16505551234"
          }]
        }
      }
    }
  };  

  callSendAPI(messageData);
}

/*
 * Send a Structured Message (Generic Message type) using the Send API.
 *
 */
function sendGenericMessage(recipientId) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      attachment: {
        type: "template",
        payload: {
          template_type: "generic",
          elements: [{
            title: "rift",
            subtitle: "Next-generation virtual reality",
            item_url: "https://www.oculus.com/en-us/rift/",               
            image_url: SERVER_URL + "/assets/rift.png",
            buttons: [{
              type: "web_url",
              url: "https://www.oculus.com/en-us/rift/",
              title: "Open Web URL"
            }, {
              type: "postback",
              title: "Call Postback",
              payload: "Payload for first bubble",
            }],
          }, {
            title: "touch",
            subtitle: "Your Hands, Now in VR",
            item_url: "https://www.oculus.com/en-us/touch/",               
            image_url: SERVER_URL + "/assets/touch.png",
            buttons: [{
              type: "web_url",
              url: "https://www.oculus.com/en-us/touch/",
              title: "Open Web URL"
            }, {
              type: "postback",
              title: "Call Postback",
              payload: "Payload for second bubble",
            }]
          }]
        }
      }
    }
  };  

  callSendAPI(messageData);
}

/*
 * Send a receipt message using the Send API.
 *
 */
function sendReceiptMessage(recipientId) {
  // Generate a random receipt ID as the API requires a unique ID
  var receiptId = "order" + Math.floor(Math.random()*1000);

  var messageData = {
    recipient: {
      id: recipientId
    },
    message:{
      attachment: {
        type: "template",
        payload: {
          template_type: "receipt",
          recipient_name: "Peter Chang",
          order_number: receiptId,
          currency: "USD",
          payment_method: "Visa 1234",        
          timestamp: "1428444852", 
          elements: [{
            title: "Oculus Rift",
            subtitle: "Includes: headset, sensor, remote",
            quantity: 1,
            price: 599.00,
            currency: "USD",
            image_url: SERVER_URL + "/assets/riftsq.png"
          }, {
            title: "Samsung Gear VR",
            subtitle: "Frost White",
            quantity: 1,
            price: 99.99,
            currency: "USD",
            image_url: SERVER_URL + "/assets/gearvrsq.png"
          }],
          address: {
            street_1: "1 Hacker Way",
            street_2: "",
            city: "Menlo Park",
            postal_code: "94025",
            state: "CA",
            country: "US"
          },
          summary: {
            subtotal: 698.99,
            shipping_cost: 20.00,
            total_tax: 57.67,
            total_cost: 626.66
          },
          adjustments: [{
            name: "New Customer Discount",
            amount: -50
          }, {
            name: "$100 Off Coupon",
            amount: -100
          }]
        }
      }
    }
  };

  callSendAPI(messageData);
}

/*
 * Send a message with Quick Reply buttons.
 *
 */
function sendQuickReply(recipientId) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      text: "What's your favorite movie genre?",
      quick_replies: [
        {
          "content_type":"text",
          "title":"Action",
          "payload":"DEVELOPER_DEFINED_PAYLOAD_FOR_PICKING_ACTION"
        },
        {
          "content_type":"text",
          "title":"Comedy",
          "payload":"DEVELOPER_DEFINED_PAYLOAD_FOR_PICKING_COMEDY"
        },
        {
          "content_type":"text",
          "title":"Drama",
          "payload":"DEVELOPER_DEFINED_PAYLOAD_FOR_PICKING_DRAMA"
        }
      ]
    }
  };

  callSendAPI(messageData);
}

/*
 * Send a read receipt to indicate the message has been read
 *
 */
function sendReadReceipt(recipientId) {
  console.log("Sending a read receipt to mark message as seen");

  var messageData = {
    recipient: {
      id: recipientId
    },
    sender_action: "mark_seen"
  };

  callSendAPI(messageData);
}

/*
 * Turn typing indicator on
 *
 */
function sendTypingOn(recipientId) {
  console.log("Turning typing indicator on");

  var messageData = {
    recipient: {
      id: recipientId
    },
    sender_action: "typing_on"
  };

  callSendAPI(messageData);
}

/*
 * Turn typing indicator off
 *
 */
function sendTypingOff(recipientId) {
  console.log("Turning typing indicator off");

  var messageData = {
    recipient: {
      id: recipientId
    },
    sender_action: "typing_off"
  };

  callSendAPI(messageData);
}

/*
 * Send a message with the account linking call-to-action
 *
 */
function sendAccountLinking(recipientId) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      attachment: {
        type: "template",
        payload: {
          template_type: "button",
          text: "Welcome. Link your account.",
          buttons:[{
            type: "account_link",
            url: SERVER_URL + "/authorize"
          }]
        }
      }
    }
  };  

  callSendAPI(messageData);
}

/*
 * Call the Send API. The message data goes in the body. If successful, we'll 
 * get the message id in a response 
 *
 */
function callSendAPI(messageData) {
  request({
    uri: 'https://graph.facebook.com/v2.6/me/messages',
    qs: { access_token: PAGE_ACCESS_TOKEN },
    method: 'POST',
    json: messageData

  }, function (error, response, body) {
    if (!error && response.statusCode == 200) {
      var recipientId = body.recipient_id;
      var messageId = body.message_id;

      if (messageId) {
        console.log("Successfully sent message with id %s to recipient %s", 
          messageId, recipientId);
      } else {
      console.log("Successfully called Send API for recipient %s", 
        recipientId);
      }
    } else {
      console.error("Failed calling Send API", response.statusCode, response.statusMessage, body.error);
    }
  });  
}

// Start server
// Webhooks must be available via SSL with a certificate signed by a valid 
// certificate authority.
app.listen(app.get('port'), function() {
  console.log('Node app is running on port', app.get('port'));
});

module.exports = app;

