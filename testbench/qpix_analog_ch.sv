`include "qpix_clkedcomparator.sv"
`include "qpix_csa.sv"

module analog_channel
        #(parameter PIXEL_TRIM_DAC_BITS = 5, // number of bits in pixel trim DAC
        parameter GLOBAL_DAC_BITS = 8,       // number of bits in global threshold DAC
        parameter CFB_CSA = 50e-15,          // feedback capacitor in CSA
        parameter VOUT_DC_CSA = 0.9,         // DC output voltage of CSA
        parameter Q_REPLENISH = 1e-15,       // replenishment charge +1fC
        parameter VDDA = 1.8,                // nominal analog supply
        parameter VOFFSET = 0.47)            // discriminator threshold offset
        (input real charge_in_r,             // input charge (C)
        input logic clock,                   // clock for comparator
        input logic [7:0] threshold_global,  // threshold DAC setting
        input logic [4:0] pixel_trim_dac,    // threshold trim    
        output logic csa_replenish,          // signal to replenish 1fC (digital output of channel)
        output real csa_vout_r,              // CSA output (V)
  	output real comp_threshold_r,        // comparator threshold (V)
        output real effective_charge);       // charge on pixel pad (C)
  		


// CSA
csa
	#(.CFB_CSA(CFB_CSA),
	.VOUT_DC_CSA(VOUT_DC_CSA),
	.Q_REPLENISH(Q_REPLENISH)
	) csa_inst (
	.csa_vout_r (csa_vout_r),
	.charge_in_r (charge_in_r),
	.csa_replenish (csa_replenish),
	.effective_charge (effective_charge)
	);

//clocked comparator 
clked_comparator
	#(.VDDA(VDDA),
	.VOFFSET(VOFFSET)
	) clked_comparator_inst (
	.call_replenishment (csa_replenish),
	.threshold_r (comp_threshold_r),
	.clock (clock),
	.signal_r (csa_vout_r),
	.threshold_global (threshold_global),
	.pixel_trim_dac (pixel_trim_dac[4:0])
	);

endmodule

