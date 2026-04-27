-Parallel v2 RTL snapshot for alternate Verilator build target.
+# larpix_v3b
diff -ur larpix_v3b_rtl_v2/src/comms_ctrl.sv larpix_v3b_rtl/src/comms_ctrl.sv
--- larpix_v3b_rtl_v2/src/comms_ctrl.sv 2026-04-26 22:24:54.057561000 -0700
+++ larpix_v3b_rtl/src/comms_ctrl.sv    2026-04-26 23:02:52.605393000 -0700
@@ -127,8 +127,8 @@
 state_e State, Next;

     // calculate parity
-always_comb
-    pkt_data = {~^read_pkt, read_pkt};
+always_comb
+    pkt_data = (pkt_chip == chip_id) ? {~^read_pkt,read_pkt} : rx_data;

 //  State register
 always_ff @(posedge clk or negedge reset_n)
@@ -224,10 +224,10 @@
                 ////read_pkt[1:0] <= CONFIG_READ_OP; // set pkt id
                 //// Build 63-bit packet in one assignment,
                 //// to avoid synthesis warning: Variable/signal is assigned by multiple non-blocking assignments
-                if ((rcvd_pkt[9:2] != chip_id) ||
-                        (rcvd_pkt[9:2] == GLOBAL_ID) ||
-                        rcvd_pkt[1:0] == DATA_OP) begin
-                        read_pkt <= rcvd_pkt[WIDTH-2:0];
+                if ((rx_data[9:2] != chip_id) ||
+                        (rx_data[9:2] == GLOBAL_ID) ||
+                        pkt_type == DATA_OP) begin
+                        read_pkt <= rx_data;
                 end else begin
                     read_pkt <= {
                         1'b1,  // bit 62 = downstream flag
diff -ur larpix_v3b_rtl_v2/src/hydra_ctrl.sv larpix_v3b_rtl/src/hydra_ctrl.sv
--- larpix_v3b_rtl_v2/src/hydra_ctrl.sv 2026-04-26 22:40:33.514477000 -0700
+++ larpix_v3b_rtl/src/hydra_ctrl.sv    2026-04-26 23:02:52.579383000 -0700
@@ -133,6 +133,8 @@
         else if (|uart_has_data) sel_onehot = priority_onehot(uart_has_data);
         else                  sel_onehot = {NUM_UARTS{1'b0}};
     end
+
+
 always_comb begin
     rx_enable = enable_posi;
     tx_enable = enable_piso_upstream | enable_piso_downstream;
@@ -151,8 +153,7 @@
     case (State)
         IDLE:
             if (|uart_has_data)             Next = RX_CAPTURE;
-            else if (!fifo_empty && ((tx_busy & enable_piso_downstream) == '0))
-                                            Next = TX_GET_FIFO;
+            else if (!fifo_empty)            Next = TX_GET_FIFO;
         RX_CAPTURE:
             if ( ((rx_data[9:2] != chip_id) || (rx_data[9:2] == GLOBAL_ID))
                 && (rx_data[62] == 0) )     Next = TX_UPSTREAM;
@@ -165,10 +166,11 @@
         RX_PROCESS:
             begin
                 if (comms_busy)             Next = RX_PROCESS;
-                else                        Next = IDLE;
+                else if (|uart_has_data)    Next = RX_CAPTURE;
+            else                            Next = IDLE;
             end
         TX_GET_FIFO:
-            if ((tx_busy & enable_piso_downstream) != '0) Next = IDLE;
+            if ((tx_busy & enable_piso_downstream) != '0) Next = TX_GET_FIFO;
             else                            Next = TX_SEND;
         TX_SEND:                            Next = IDLE;

@@ -192,14 +194,16 @@
         fifo_read_n <= 1'b1;
         uld_rx_data_uart <=4'h0;
         case (State)
-            IDLE:
-                case (sel_onehot)
-                    4'b0001 : rx_data <= rx_data_uart[2'b00];
-                    4'b0010 : rx_data <= rx_data_uart[2'b01];
-                    4'b0100 : rx_data <= rx_data_uart[2'b10];
-                    4'b1000 : rx_data <= rx_data_uart[2'b11];
-                    default : rx_data <= rx_data;
-                endcase
+            IDLE:
+                if (|uart_has_data)
+                    case (sel_onehot)
+                        4'b0001 : rx_data <= rx_data_uart[2'b00];
+                        4'b0010 : rx_data <= rx_data_uart[2'b01];
+                        4'b0100 : rx_data <= rx_data_uart[2'b10];
+                        4'b1000 : rx_data <= rx_data_uart[2'b11];
+                        default : rx_data <= '0;
+                    endcase
+

             RX_CAPTURE:
                 begin
