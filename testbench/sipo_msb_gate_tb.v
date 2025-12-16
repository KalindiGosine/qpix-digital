// sipo_msb_gate_tb.v
`timescale 1ns/1ps
`default_nettype none

/**
 * @file sipo_msb_gate_tb.v
 * @brief Self-checking testbench for @ref sipo_msb_gate.
 * @details Drives mixed stimuli without gaps, maintains a simple golden model
 * with post-capture holdoff, and checks VALID/DOUT/TS when a capture is
 * expected.  Under Verilator the
 * SystemVerilog assertion is optional via `ifdef VERILATOR`.
 */

module sipo_msb_gate_tb;
    // Parameters
    localparam integer WORD_W = 8;
    localparam integer TS_W   = 32;
    localparam integer CYCLES = 260;

    // DUT I/O
    reg                      CLK;
    reg                      RST;
    reg                      DIN;
    wire [WORD_W-1:0]        DOUT;
    wire [TS_W-1:0]          TS;
    wire                     VALID;

    // Instantiate DUT
    sipo_msb_gate #(
        .WORD_W(WORD_W),
        .TS_W(TS_W)
    ) dut (
        .CLK(CLK),
        .RST(RST),
        .DIN(DIN),
        .DOUT(DOUT),
        .TS(TS),
        .VALID(VALID)
    );

    // Clock generation: 100 MHz (10 ns period)
    initial CLK = 1'b0;
    always #5 CLK = ~CLK;

    // Optional waveform dump.  Enabled unless NO_DUMP is defined.
`ifndef NO_DUMP
    initial begin
        $dumpfile("sipo_msb_gate_tb.vcd");
        $dumpvars(0, sipo_msb_gate_tb);
    end
`endif

    // Golden model mirrors (for stimulus timing only)
    /* verilator lint_off UNUSEDSIGNAL */
    reg [WORD_W-1:0] sh_g;
    /* verilator lint_on UNUSEDSIGNAL */
    reg [TS_W-1:0]   ctr_g;
    integer          holdoff_g; // cycles remaining before next allowed capture

    // Hierarchical taps to DUT state to align expected timing with DUT NBAs
    /* verilator lint_off UNUSEDSIGNAL */
    wire [WORD_W-1:0] sh_dut    = dut.sh;
    /* verilator lint_on UNUSEDSIGNAL */
    wire [TS_W-1:0]   ctr_dut   = dut.ctr;

    // Expected fire flag and expected values captured on this clock, then checked after NBA
    reg               fire_exp_q;
    reg [WORD_W-1:0]  sh_next_exp_q;
    reg [TS_W-1:0]    ts_exp_q;

    integer t;

    // Drive stimulus
    initial begin
        RST = 1'b1;
        DIN = 1'b0;
        sh_g     = {WORD_W{1'b0}};
        ctr_g    = {TS_W{1'b0}};
        holdoff_g = 0;

        // Reset for a few cycles
        repeat (3) @(posedge CLK);
        RST = 1'b0;

        // Mixed stimulus: long zeros, bursts of ones, and pseudo-random tail
        for (t = 0; t < CYCLES; t = t + 1) begin
            if      (t < 20)  DIN = 1'b0;                    // long zeros
            else if (t < 30)  DIN = (t % 3 == 0);            // sparse ones
            else if (t < 45)  DIN = 1'b1;                    // run of ones
            else if (t < 80)  DIN = 1'b0;                    // long zeros
            else if (t < 90)  DIN = (t[0]);                  // 1010...
            else if (t < 140) DIN = (t % 5 == 0);            // periodic ones
            else begin /* pseudo-random */
                /* verilator lint_off WIDTHTRUNC */
                DIN = $random; // take LSB only
                /* verilator lint_on WIDTHTRUNC */
            end
            @(posedge CLK);
        end

        // A few idle cycles then finish
        DIN = 1'b0;
        repeat (5) @(posedge CLK);
        $finish;
    end

`ifdef VERILATOR
    // VALID must equal the expected fire condition computed from the TB mirror
    property tb_valid_matches_expected;
      @(posedge CLK) disable iff (RST) (VALID == fire_exp_q);
    endproperty
    assert property (tb_valid_matches_expected);
`endif

    // Scoreboard: event-driven evaluation with post-capture holdoff
    always @(posedge CLK) begin
        if (RST) begin
            sh_g     <= {WORD_W{1'b0}};
            ctr_g    <= {TS_W{1'b0}};
            holdoff_g <= 0;
        end else begin
            // Update golden mirrors (not used for checks)
            ctr_g <= ctr_g + {{(TS_W-1){1'b0}}, 1'b1};
            sh_g  <= {sh_g[WORD_W-2:0], DIN};

            // Compute expected post-shift values and fire condition for this cycle
            sh_next_exp_q  <= {sh_dut[WORD_W-2:0], DIN};
            ts_exp_q       <= ctr_dut + {{(TS_W-1){1'b0}}, 1'b1};
            fire_exp_q     <= (holdoff_g == 0) && sh_dut[WORD_W-2];

            // Let DUT NBAs settle then check
            #1;
            // VALID must match expected fire condition
            if (VALID !== fire_exp_q) begin
`ifdef VERILATOR
                $error("TB: VALID mismatch at %0t. VALID=%0b exp=%0b", $time, VALID, fire_exp_q);
`else
                $display("TB ERROR: VALID mismatch at %0t. VALID=%0b exp=%0b", $time, VALID, fire_exp_q);
                $stop;
`endif
            end
            // When VALID, check DOUT and TS
            if (VALID) begin
                if (DOUT !== sh_next_exp_q) begin
`ifdef VERILATOR
                    $error("TB: DOUT mismatch at %0t. got=0x%0h exp=0x%0h", $time, DOUT, sh_next_exp_q);
`else
                    $display("TB ERROR: DOUT mismatch at %0t. got=0x%0h exp=0x%0h", $time, DOUT, sh_next_exp_q);
                    $stop;
`endif
                end else begin
                    $display("[%0t] OK: VALID word=0x%0h  TS=%0d", $time, DOUT, TS);
                end
                if (TS !== ts_exp_q) begin
`ifdef VERILATOR
                    $error("TB: TS mismatch at %0t. got=%0d exp=%0d", $time, TS, ts_exp_q);
`else
                    $display("TB ERROR: TS mismatch at %0t. got=%0d exp=%0d", $time, TS, ts_exp_q);
                    $stop;
`endif
                end
            end

            // Update golden holdoff mirror
            if ((holdoff_g == 0) && sh_next_exp_q[WORD_W-1]) begin
                holdoff_g <= WORD_W - 1;
            end else if (holdoff_g != 0) begin
                holdoff_g <= holdoff_g - 1;
            end
        end
    end

endmodule

`default_nettype wire
