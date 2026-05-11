# `msg_rtl` File Summary

This note summarizes the **files copied from the original `v3c2` RTL and then modified inside `larpix_network_sim/msg_rtl/src`** to support the `MSG_OP` mechanism, plus the **new file added** for message-specific logic.

## Modified `v3c2`-derived files

- [larpix_network_sim/msg_rtl/src/larpix_constants.sv](/home/lxusers/k/kalindigosine/snrlab-ic-q-pix-v1/chip_network_sim/larpix_network_sim/msg_rtl/src/larpix_constants.sv:95)
  Defines `MSG_OP = 2'b00`, `MSG_WIDTH = 24`, and the message-specific parity/downstream bit positions.

- [larpix_network_sim/msg_rtl/src/uart_rx.sv](/home/lxusers/k/kalindigosine/snrlab-ic-q-pix-v1/chip_network_sim/larpix_network_sim/msg_rtl/src/uart_rx.sv:73)
  Detects `MSG_OP` after the first two LSBs and shortens RX framing to `MSG_WIDTH` instead of always receiving 64 bits.

- [larpix_network_sim/msg_rtl/src/uart_tx.sv](/home/lxusers/k/kalindigosine/snrlab-ic-q-pix-v1/chip_network_sim/larpix_network_sim/msg_rtl/src/uart_tx.sv:68)
  Chooses a transmit length of 24 bits for `MSG_OP` and 64 bits for all other packet types.

- [larpix_network_sim/msg_rtl/src/comms_ctrl.sv](/home/lxusers/k/kalindigosine/snrlab-ic-q-pix-v1/chip_network_sim/larpix_network_sim/msg_rtl/src/comms_ctrl.sv:69)
  Adds `MSG_OP` parity/malformed handling.
  At [comms_ctrl.sv:248](/home/lxusers/k/kalindigosine/snrlab-ic-q-pix-v1/chip_network_sim/larpix_network_sim/msg_rtl/src/comms_ctrl.sv:248), any `MSG_OP` is routed to `msg_logic` via `msg_valid/msg_pkt_data` instead of entering the shared Hydra FIFO.

- [larpix_network_sim/msg_rtl/src/hydra_ctrl.sv](/home/lxusers/k/kalindigosine/snrlab-ic-q-pix-v1/chip_network_sim/larpix_network_sim/msg_rtl/src/hydra_ctrl.sv:108)
  Adds message-aware downstream-bit handling for `MSG_OP`.
  At [hydra_ctrl.sv:162](/home/lxusers/k/kalindigosine/snrlab-ic-q-pix-v1/chip_network_sim/larpix_network_sim/msg_rtl/src/hydra_ctrl.sv:162), adds arbitration between the shared Hydra FIFO and the message FIFO.
  At [hydra_ctrl.sv:177](/home/lxusers/k/kalindigosine/snrlab-ic-q-pix-v1/chip_network_sim/larpix_network_sim/msg_rtl/src/hydra_ctrl.sv:177), message packets are allowed onto both upstream and downstream enabled TX lanes.

- [larpix_network_sim/msg_rtl/src/external_interface.sv](/home/lxusers/k/kalindigosine/snrlab-ic-q-pix-v1/chip_network_sim/larpix_network_sim/msg_rtl/src/external_interface.sv:24)
  Wires the new message path through the chip: `runtime_id`, `msg_valid`, `msg_pkt_data`, `msg_fifo_empty`, `msg_read_n`, and `msg_data_out`.
  The `msg_logic` instance is connected at [external_interface.sv:121](/home/lxusers/k/kalindigosine/snrlab-ic-q-pix-v1/chip_network_sim/larpix_network_sim/msg_rtl/src/external_interface.sv:121).

- [larpix_network_sim/msg_rtl/src/digital_core.sv](/home/lxusers/k/kalindigosine/snrlab-ic-q-pix-v1/chip_network_sim/larpix_network_sim/msg_rtl/src/digital_core.sv:105)
  Adds `runtime_id` as a top-level RTL input for per-runtime PRNG seeding and passes it into `external_interface` at [digital_core.sv:449](/home/lxusers/k/kalindigosine/snrlab-ic-q-pix-v1/chip_network_sim/larpix_network_sim/msg_rtl/src/digital_core.sv:449).

## Added file

- [larpix_network_sim/msg_rtl/src/msg_logic.sv](/home/lxusers/k/kalindigosine/snrlab-ic-q-pix-v1/chip_network_sim/larpix_network_sim/msg_rtl/src/msg_logic.sv:1)
  New block added for message-specific handling.
  Key responsibilities:
  - transform received `MSG_OP` packets by incrementing payload bits `[13:10]` and recomputing parity at [msg_logic.sv:58](/home/lxusers/k/kalindigosine/snrlab-ic-q-pix-v1/chip_network_sim/larpix_network_sim/msg_rtl/src/msg_logic.sv:58)
  - generate local broadcast-style messages at [msg_logic.sv:66](/home/lxusers/k/kalindigosine/snrlab-ic-q-pix-v1/chip_network_sim/larpix_network_sim/msg_rtl/src/msg_logic.sv:66)
  - seed its generator from `runtime_id` at [msg_logic.sv:85](/home/lxusers/k/kalindigosine/snrlab-ic-q-pix-v1/chip_network_sim/larpix_network_sim/msg_rtl/src/msg_logic.sv:85)
  - hold pending messages in a dedicated 4-deep `msg_fifo` at [msg_logic.sv:96](/home/lxusers/k/kalindigosine/snrlab-ic-q-pix-v1/chip_network_sim/larpix_network_sim/msg_rtl/src/msg_logic.sv:96)
