module csa 
        #(parameter CFB_CSA = 50e-15,   // 50 fF feedback cap
        parameter VOUT_DC_CSA = 0.9,  // CSA reference voltage
        parameter Q_REPLENISH = 1e-15) // replenishment charge is 1fC  
        (output real csa_vout_r,    // csa output voltage   
         output real effective_charge,
        input real charge_in_r,     // input signal
        input logic csa_replenish   // replenishment charge on the input
        );

//initialize
initial effective_charge = 0;

// when charge_in changes OR you get a replenishment, update your CSA:
always @(charge_in_r or posedge csa_replenish) begin
	if (csa_replenish)	// if replenishment arrives, update the effective charge
	effective_charge = effective_charge - Q_REPLENISH;
	else 			// otherwise, your charge_in changed, in which case update the effective charge to match
	effective_charge = effective_charge + charge_in_r;  
end 
// slightly concerned you could that you could get a replenishment & more charge at the same time and this code would only respond to the replenishment


// continuously update output voltage
always_comb begin
	// Vout = Vref + (-Q)/C 
	//$display("charge_in = %0.4f", charge_in_r*1e15);
	csa_vout_r = VOUT_DC_CSA + (effective_charge/ CFB_CSA);
	//$display("effective charge = %0.3f", effective_charge*1e15);
end


endmodule




