module clked_comparator
	#(parameter VDDA = 1.8,
	parameter VOFFSET = 0.470)             
	(output logic call_replenishment,       // clked_comp  output bit which calls for a replenishment 
	output real threshold_r,				// make the actual comp thresh(V) accessible
	input real signal_r,                   // input signal (csa output)
	input logic clock,                    // sampling clock
	input logic [7:0] threshold_global,    // threshold DAC setting
	input logic [4:0] pixel_trim_dac       // threshold trim (fine tuning the threshold voltage)
	);

real global_lsb_r, trim_lsb_r;

//output assignment for clked comparator. output can only be high when Clk is high & csa_out is above threshold
always_comb begin
	call_replenishment = (clock && (signal_r > threshold_r)) ? 1'b1: 1'b0;
end


// dac model (didn't touch this) 
always @(*) begin
	global_lsb_r = VDDA/256; // global LSB ~ 7mV nominal
	trim_lsb_r = 0.05/32; // trim has 50 mV range
	threshold_r = VOFFSET + threshold_global*global_lsb_r + pixel_trim_dac*trim_lsb_r;
end

endmodule

