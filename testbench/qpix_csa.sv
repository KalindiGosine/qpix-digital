module csa 
	#(parameter CFB_CSA = 50e-15,   // 50 fF feedback cap
	parameter VOUT_DC_CSA = 0.9,  // CSA reference voltage
	parameter Q_REPLENISH = 1e-15) // replenishment charge is 1fC  
	(output real csa_vout_r,    // csa output voltage	
	input real charge_in_r,     // input signal
	input logic csa_replenish   // replenishment charge on the input
	);


// CSA. Note charge is in columbs and negative bc electrons. Charge deposited on input makes input 
// voltage decrease. Since CSA is inverting, CSA output increases as  electrons are added. 

	always @(*) begin      // always will execute this block when any (*) signals change 
		if (csa_replenish)		 // describes what to do when experiencing a replenishment 
			charge_in_r = charge_in_r + Q_REPLENISH // add +1fC of charge to the CSA input 
             		csa_vout_r = VOUT_DC_CSA;
       		else		// this is regular, charge integrating behavior (Int_out=Int_out+-(-Q)/C)
			csa_vout_r = csa_vout_r + -(charge_in_r/CFB_CSA);
end

endmodule
