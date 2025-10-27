`timescale 1ns/1ps
`include "qpix_analog_ch.sv"

module analog_channel_tb;
	real  charge_in_r;                 // analog charge input
	real  comp_threshold_r;
	real  effective_charge;
	real  csa_vout_r;
	logic clock;                       // 50 MHz clock
	logic [7:0] threshold_global;      // global threshold DAC
	logic [4:0] pixel_trim_dac;        // per-pixel trim DAC
	logic csa_replenish;               // DUT output

initial begin
	clock = 1'b0;
	forever #10 clock = ~clock;      // toggles every 10 ns
end

initial begin						 
	threshold_global  = 8'd63;      // use equation in dac model of clkedcomparator.sv. should be ~910mV (d63)
	pixel_trim_dac    = 5'd0;       // no trim
	#30 charge_in_r       = 8e-15;  // 8 fC at 30ns delay
end
  

analog_channel 
	analog_ch_inst (
	.charge_in_r      (charge_in_r),
	.clock            (clock),
	.threshold_global (threshold_global),
	.pixel_trim_dac   (pixel_trim_dac),
	.csa_replenish    (csa_replenish),
	.comp_threshold_r (comp_threshold_r),
	.csa_vout_r (csa_vout_r),
	.effective_charge (effective_charge)
	);


initial begin
	$display("time(ns)\t effective_charge(fC)\t threshold \t csa_replenish\t csa_vout");
	$monitor("%0t \t %0.3f \t \t %0.3f \t  \t %b \t %0.5f \t %b ", $time, effective_charge*1e15, comp_threshold_r,  csa_replenish, csa_vout_r, clock);
end




initial begin
	#400;  // run for 0.4 us
	$finish;
end

endmodule

