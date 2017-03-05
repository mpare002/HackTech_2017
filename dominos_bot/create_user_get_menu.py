
from pizzapi import *
import json

def order():
	# idk, since im running it throuhg javascript maybe it needs absolute path?! or uses the javascript codes dir as the base dir?
	f = open("/Users/ethanlo1/Documents/projects/hacktech/HackTech_2017/dominos_bot/pizza_order.txt", "r")

	firstname = str(f.readline())
	lastname = str(f.readline())
	email = str(f.readline())
	phone_number = str(f.readline())

	street = str(f.readline())
	city = str(f.readline())
	state = str(f.readline())
	zipcode = str(f.readline())

	f.close()
	f = open("/Users/ethanlo1/Documents/projects/hacktech/HackTech_2017/dominos_bot/pizza_order.txt", "w")



	print 'Creating Customer...'
	customer = Customer(firstname, lastname, email, phone_number)
	customer.set_address(street, city,  state, zipcode)

	print 'Finding closest Store...'
	try:
		store = find_closest_store(customer.address)
	except Exception as xxx:
		print(xxx);
		f.write("<pizza> Sorry! ");
		f.write(str(xxx));
		return;


	print 'Creating Order...'
	try:
		order = Order(store, customer)
	except Exception as xxx:
		print(xxx);
		f.write("<pizza> Sorry! ");
		f.write(str(xxx));
		return;

	print 'Searching the store\'s Menu for Pepperoni...'
	try:
		menu = store.get_menu()
		menu.search(Name='Hand Tossed', SizeCode='24')
		menu.search(Name='Pepperoni')
	except Exception as xxx:
		print(xxx);
		f.write("<pizza> Sorry! ");
		f.write(str(xxx));
		return;

	try:
		order.add_item('P16IBKPX')
	except Exception as xxx:
		print(xxx);
		f.write("<pizza> Sorry! ");
		f.write(str(xxx));
		return;

	print 'PIZZA ADDED' 


	#print 'Creating the PaymentObject...'
	#card = PaymentObject('4100123422343234', '0115', '777', '90210')

	print 'Placing the order...'
	#order.pay_with(card)
	#data = order.data

	#data = order.place(card)

	f.write("<pizza> Pizza successfully ordered.");


	# TODO: Add order tracking tests here

	#int'Success\n\norder.data:', json.dumps(data, indent=4)


order()






