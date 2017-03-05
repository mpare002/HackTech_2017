
from pizzapi import *
import json

f = open("pizza_order.txt", "r")

firstname = str(f.readline())
lastname = str(f.readline())
email = str(f.readline())
phone_number = str(f.readline())

street = str(f.readline())
city = str(f.readline())
state = str(f.readline())
zipcode = str(f.readline())


print 'Creating Customer...'
customer = Customer(firstname, lastname, email, phone_number)
customer.set_address(street, city,  state, zipcode)

print 'Finding closest Store...'
store = find_closest_store(customer.address)

print 'Creating Order...'
order = Order(store, customer)

print 'Searching the store\'s Menu for Pepperoni...'
menu = store.get_menu()
menu.search(Name='Hand Tossed', SizeCode='24')
menu.search(Name='Pepperoni')

order.add_item('P16IBKPX')
print 'PIZZA ADDED' 


#print 'Creating the PaymentObject...'
#card = PaymentObject('4100123422343234', '0115', '777', '90210')

print 'Placing the order...'
#order.pay_with(card)
#data = order.data

#data = order.place(card)

# TODO: Add order tracking tests here

#int'Success\n\norder.data:', json.dumps(data, indent=4)
