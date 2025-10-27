'timescale 1ns/1ps

module singlechannel_tb(); 

parameter input_charge = 8e-15  //8fC of input charge

initial begin 
	$monitor ("Number of replenishments=%d", csa_replenishments); 
	
