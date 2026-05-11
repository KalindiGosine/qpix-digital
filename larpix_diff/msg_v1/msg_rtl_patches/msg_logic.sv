///////////////////////////////////////////////////////////////////
// File Name: msg_logic.sv
// Description: Message-packet transform and holding FIFO for MSG_OP.
//              Preserves the packet type bits [1:0] and the dedicated
//              origin chip field in the message payload, increments only the
//              low 4-bit message payload by one, then recomputes
//              parity before enqueueing into a 4-deep FIFO.
//              Also includes a local broadcast-style message generator.
//              Generated-message payload format:
//                [11:4] = origin chip ID
//                [3:0]  = local message counter
///////////////////////////////////////////////////////////////////

module msg_logic
    #(parameter int WIDTH = 64,
    parameter int FIFO_DEPTH = 4,
    parameter int FIFO_BITS = 2,
    parameter int GLOBAL_ID = 255)
    (output logic [WIDTH-1:0] msg_data_out,
    output logic msg_fifo_empty,
    output logic ready_for_msg,
    input logic [WIDTH-1:0] msg_data_in,
    input logic msg_valid_in,
    input logic [7:0] runtime_id,
    input logic [7:0] chip_id,
    input logic msg_read_n,
    input logic clk,
    input logic reset_n);

`include "larpix_constants.sv"

logic [MSG_WIDTH-2:0] payload_out;
logic msg_fifo_full;
logic msg_fifo_half;
logic [FIFO_BITS:0] msg_fifo_counter;
logic msg_write_n;
logic [MSG_WIDTH-1:0] transformed_msg;
logic [MSG_WIDTH-1:0] msg_fifo_data_out;
logic [MSG_WIDTH-1:0] generated_msg;
logic [MSG_WIDTH-1:0] msg_fifo_data_in;
logic msg_gen_valid;
logic msg_fifo_wr_valid;
logic [7:0] gen_lfsr;
logic [3:0] gen_msg_counter;
logic [11:0] generated_payload;

function automatic logic [MSG_WIDTH-1:0] build_msg_packet(
    input logic [11:0] payload_bits,
    input logic [7:0] msg_chip_id,
    input logic downstream_flag);
    logic [MSG_WIDTH-2:0] body;
    begin
        body = {downstream_flag, payload_bits, msg_chip_id, MSG_OP};
        return {~^body, body};
    end
endfunction

always_comb begin
    payload_out = {
        msg_data_in[MSG_DOWNSTREAM_BIT], // preserve downstream flag
        msg_data_in[21:14],              // preserve origin chip ID
        msg_data_in[13:10] + 4'b0001,    // increment the 4-bit payload
        msg_data_in[9:0]                 // preserve destination chip field and opcode
    };
    transformed_msg = {~^payload_out, payload_out};
    generated_payload = {chip_id, gen_msg_counter};
    generated_msg = build_msg_packet(generated_payload, GLOBAL_ID[7:0], 1'b1);
    msg_data_out = '0;
    msg_data_out[MSG_WIDTH-1:0] = msg_fifo_data_out;
    ready_for_msg = !msg_fifo_full;
    msg_gen_valid = (gen_lfsr < 8'd3);
    if (msg_valid_in) begin
        msg_fifo_wr_valid = ready_for_msg;
        msg_fifo_data_in = transformed_msg;
    end else if (msg_gen_valid && ready_for_msg) begin
        msg_fifo_wr_valid = 1'b1;
        msg_fifo_data_in = generated_msg;
    end else begin
        msg_fifo_wr_valid = 1'b0;
        msg_fifo_data_in = '0;
    end
    msg_write_n = !msg_fifo_wr_valid;
end

always_ff @(posedge clk or negedge reset_n) begin
    if (!reset_n) begin
        gen_lfsr <= {runtime_id[6:0], 1'b1};
        gen_msg_counter <= 4'h0;
    end else begin
        gen_lfsr <= {gen_lfsr[6:0], gen_lfsr[7] ^ gen_lfsr[5] ^ gen_lfsr[4] ^ gen_lfsr[3]};
        if (!msg_valid_in && msg_gen_valid && ready_for_msg)
            gen_msg_counter <= gen_msg_counter + 1'b1;
    end
end

fifo_latch #(
    .FIFO_WIDTH(MSG_WIDTH),
    .FIFO_DEPTH(FIFO_DEPTH),
    .FIFO_BITS(FIFO_BITS))
    msg_fifo_inst(
    .data_out       (msg_fifo_data_out),
    .fifo_counter   (msg_fifo_counter),
    .fifo_full      (msg_fifo_full),
    .fifo_half      (msg_fifo_half),
    .fifo_empty     (msg_fifo_empty),
    .data_in        (msg_fifo_data_in),
    .read_n         (msg_read_n),
    .write_n        (msg_write_n),
    .clk            (clk),
    .reset_n        (reset_n));

endmodule
