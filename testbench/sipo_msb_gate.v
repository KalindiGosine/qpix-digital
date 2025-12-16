// sipo_msb_gate.v
`timescale 1ns/1ps
`default_nettype none

/**
 * @file sipo_msb_gate.v
 * @brief MSB-gated SIPO with timestamp and post-capture holdoff.
 * @details Serial-in/parallel-out converter that shifts LSB-first every @p CLK
 * and evaluates the post-shift MSB each cycle.  When allowed (no holdoff) and
 * the post-shift MSB is 1, the module latches @p DOUT and @p TS and asserts
 * @p VALID for one clock.  After any @p VALID, a holdoff of @p WORD_W-1 cycles
 * suppresses further captures to avoid overlap.  The timestamp @p TS is a
 * free-running counter incremented each clock.
 *
 * @tparam WORD_W Data word width in bits.  Must be >= 2.
 * @tparam TS_W   Timestamp width in bits.
 *
 * @param CLK   Rising-edge clock.
 * @param RST   Active-high synchronous reset.
 * @param DIN   Serial input bit.  Sampled on each rising edge of @p CLK.
 * @param DOUT  Latched parallel word on boundary when MSB==1.
 * @param TS    Timestamp captured with @p DOUT.
 * @param VALID One-cycle strobe high when @p DOUT/@p TS update.
 *
 * @note There are no fixed windows.  After any latch, the next possible latch
 *       occurs at least @p WORD_W clocks later due to holdoff.
 */
module sipo_msb_gate #(
    parameter integer WORD_W = 16, // Data word width (>= 2)
    parameter integer TS_W   = 64  // Timestamp width
) (
    input  wire                 CLK,   // Clock
    input  wire                 RST,   // Active-high synchronous reset
    input  wire                 DIN,   // Serial input, sampled on CLK rising edge
    output reg  [WORD_W-1:0]    DOUT,  // Latched output word at window boundary
    output reg  [TS_W-1:0]      TS,    // Timestamp latched with DOUT
    output reg                  VALID  // One-cycle pulse when DOUT/TS update
);

    // Synthesis-time guard
    initial begin
        if (WORD_W < 2) begin
            $error("WORD_W must be >= 2");
        end
    end

    // Free-running timestamp counter
    reg [TS_W-1:0] ctr;

    // Shift register
    reg [WORD_W-1:0] sh;

    // Trigger holdoff counter: number of cycles to suppress captures after VALID
    integer holdoff;

    // Next-state helpers to align captures to post-shift values
    wire [WORD_W-1:0] sh_next  = {sh[WORD_W-2:0], DIN};
    wire              msb_next = sh_next[WORD_W-1];
    wire [TS_W-1:0]   ctr_next = ctr + {{(TS_W-1){1'b0}}, 1'b1};

    always @(posedge CLK) begin
        if (RST) begin
            ctr     <= {TS_W{1'b0}};
            sh      <= {WORD_W{1'b0}};
            DOUT    <= {WORD_W{1'b0}};
            TS      <= {TS_W{1'b0}};
            VALID   <= 1'b0;
            holdoff <= 0; // No holdoff after reset; wait for first MSB==1 event
        end else begin
            // Defaults
            VALID <= 1'b0;

            // Free-run the counter and shift every cycle
            ctr <= ctr_next;
            sh  <= sh_next;

            // Event-driven latch rule with post-capture holdoff
            if (holdoff == 0) begin
                if (msb_next) begin
                    DOUT  <= sh_next;
                    TS    <= ctr_next;         // Associate event with this clock index
                    VALID <= 1'b1;             // One-cycle strobe
                    holdoff <= WORD_W - 1;     // Suppress next WORD_W-1 cycles; allow again at t+WORD_W
                end
                // else remain in holdoff==0, waiting for next fresh MSB==1
            end else begin
                holdoff <= holdoff - 1;
            end
        end
    end

`ifdef VERILATOR
    // Strong RTL-time checks using previous-cycle expected registers to avoid NBA races.
    reg [WORD_W-1:0] sh_next_q;
    reg [TS_W-1:0]   ctr_next_q;
    reg              fire_exp_q;    // previous-cycle expected VALID condition
    always @(posedge CLK) begin
        if (RST) begin
            sh_next_q  <= {WORD_W{1'b0}};
            ctr_next_q <= {TS_W{1'b0}};
            fire_exp_q <= 1'b0;
        end else begin
            sh_next_q  <= sh_next;
            ctr_next_q <= ctr_next;
            fire_exp_q <= (holdoff == 0) && msb_next;
        end
    end

    always @(posedge CLK) begin
        if (!RST) begin
            if (VALID !== fire_exp_q) begin
`ifdef VERILATOR
                $error("RTL: VALID mismatch. got=%0b exp=%0b at %0t", VALID, fire_exp_q, $time);
`endif
            end
            if (VALID) begin
                if (DOUT !== sh_next_q) begin
                    $error("RTL: DOUT mismatch at %0t. got=0x%0h exp=0x%0h", $time, DOUT, sh_next_q);
                end
                if (TS !== ctr_next_q) begin
                    $error("RTL: TS mismatch at %0t. got=%0d exp=%0d", $time, TS, ctr_next_q);
                end
            end
        end
    end
`endif

`ifndef SYNTHESIS
    // Rising-edge VALID check using previous-cycle holdoff (allow) state.
    reg valid_prev;
    reg allow_prev; // holdoff==0 sampled previous cycle
    always @(posedge CLK) begin
        if (RST) begin
            valid_prev <= 1'b0;
            allow_prev <= 1'b0;
        end else begin
            if (VALID && !valid_prev) begin
`ifdef VERILATOR
                if (!allow_prev) $error("VALID rose while holdoff active at %0t", $time);
`else
                if (!allow_prev) begin
                    $display("ERROR: VALID rose while holdoff active at %0t", $time);
                    $stop;
                end
`endif
            end
            valid_prev <= VALID;
            allow_prev <= (holdoff == 0);
        end
    end
`endif

endmodule

`default_nettype wire
