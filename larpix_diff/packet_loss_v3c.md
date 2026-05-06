# Packet Loss : `v3c` to `v3c2`

## Summary

This note records the incremental `2x2` packet-loss investigation performed on the `v3c` RTL and the then modified `v3c2` tree. The goal was to re-apply the four fixes that had previously separated `v3b` from `v3b2`, but to do so one change at a time and preserve a playback/debug snapshot after each edit.

The common probe setup is the same as the earlier `v3b`/`v3b2` study:

- all `64` channels on chip `1` inject at tick `1000`
- all `64` channels on chip `2` inject at tick `1000`
- chip `0` receives both return streams on its `east` and `north` RX lanes
- the network therefore contains `128` unique packets that should eventually reach the FPGA

The final outcome of the `v3c2` sequence is:

- after Edits `1-3`, the packet corruption symptoms improve stepwise but total forwarding is still limited
- after Edit `4`, the packet-loss bug is removed in the `2x2` case
- with a sufficiently long drain tail, chip `0` forwards all `128` packets and the FPGA receives all `128`

## Probe Topology

```text
  y=1:  2  3
  y=0:  0  1
```

Where:

- chip `0` is the source chip and FPGA-facing sink path
- chip `1` injects all `64` channels at tick `1000`
- chip `2` injects all `64` channels at tick `1000`

This forces two simultaneous return streams into chip `0`:

- chip `2` -> chip `0` on chip `0`'s `north` RX lane
- chip `1` -> chip `0` on chip `0`'s `east` RX lane

## What Was Measured

The probe records:

1. Per-chip packet trace
- `rx_packet`
- `tx_packet`

2. FPGA receive log
- all packets printed by `fpga_larpix`

3. Per-tick chip-0 internal state sampled from the Verilated model
- Hydra FSM state and next state
- selected lane and unload mask
- live Hydra `rx_data`
- `comms_ctrl` `rcvd_pkt` and `read_pkt`
- per-lane `rx_empty`, `hold_valid`, `rx_data`, `hold_reg`
- Hydra FIFO state
  - `fifo_rd_data`
  - `read_pointer`
  - `write_pointer`
  - `fifo_counter`
  - `fifo_mem0`
  - `fifo_mem1`
  - `fifo_read_n`
  - internal `fifo_write_n`

## Baseline `v3c`

Artifacts:

- [run.log](/home/lxusers/k/kalindigosine/snrlab-ic-q-pix-v1/chip_network_sim/build/larpix_2x2_packet_loss_probe_v3c/run.log)
- [trace.jsonl](/home/lxusers/k/kalindigosine/snrlab-ic-q-pix-v1/chip_network_sim/build/larpix_2x2_packet_loss_probe_v3c/trace.jsonl)
- [chip0_rx_debug.csv](/home/lxusers/k/kalindigosine/snrlab-ic-q-pix-v1/chip_network_sim/build/larpix_2x2_packet_loss_probe_v3c/chip0_rx_debug.csv)
- [packet_loss_summary.json](/home/lxusers/k/kalindigosine/snrlab-ic-q-pix-v1/chip_network_sim/build/larpix_2x2_packet_loss_probe_v3c/packet_loss_summary.json)

Observed result:

- chip `0` receives all `64` north packets and all `64` east packets
- chip `0` forwards only `64` packets onward
- FPGA sees only chip `2`
  - unique packets from chip `2`: `32`
  - total arrivals from chip `2`: `64`

## `v3c2` Edit 1: `hydra_ctrl.sv` `RX_PROCESS -> IDLE`

This follow-up experiment keeps the `v3c` RTL as the baseline and introduces only the first Hydra RX-state change in a separate `v3c2` tree. The goal is to measure the effect of that one change by itself before applying the later `v2` fixes.

The only behavioral change between `v3c` and `v3c2` is in:

- [`larpix_network_sim/larpix_v3c/src/hydra_ctrl.sv`](/home/lxusers/k/kalindigosine/snrlab-ic-q-pix-v1/chip_network_sim/larpix_network_sim/larpix_v3c/src/hydra_ctrl.sv:169)
- [`larpix_network_sim/larpix_v3c2/src/hydra_ctrl.sv`](/home/lxusers/k/kalindigosine/snrlab-ic-q-pix-v1/chip_network_sim/larpix_network_sim/larpix_v3c2/src/hydra_ctrl.sv:169)

`v3c` lines `169-173`:

```systemverilog
        RX_PROCESS:
            begin
                if (comms_busy)             Next = RX_PROCESS;
                else if (|uart_has_data)    Next = RX_CAPTURE;
            else                            Next = IDLE;
            end
```

`v3c2` lines `169-172`:

```systemverilog
        RX_PROCESS:
            begin
                if (comms_busy)             Next = RX_PROCESS;
                else                        Next = IDLE;
            end
```

This is the same first fix that was introduced in the successful `v3b2` path: once `comms_ctrl` is no longer busy, Hydra must return to `IDLE` before selecting and unloading another RX lane. That forces `rx_data` to refresh through the `IDLE` state instead of letting Hydra jump directly back into `RX_CAPTURE`.

The reason we need to return to `IDLE` is because it is only in this state that incoming packets get loaded into the hydra data. In the v3c RTL, the east data packet is unloaded in the `RX_PROCESS` state but was never actually loaded into the hydra `rx_data`. See ticks 1082-1088 in the v3c RTL and note how `uld_rx=east` while `rx_data=` always holds the north packet; additionally note how after `RX_PROCESS`, hydra state does not go back to `IDLE`. This behavior was the focus of this first edit. 

### Result

Artifacts:

- [run.log](/home/lxusers/k/kalindigosine/snrlab-ic-q-pix-v1/chip_network_sim/build/larpix_2x2_packet_loss_probe_v3c2/run.log)
- [trace.jsonl](/home/lxusers/k/kalindigosine/snrlab-ic-q-pix-v1/chip_network_sim/build/larpix_2x2_packet_loss_probe_v3c2/trace.jsonl)
- [chip0_rx_debug.csv](/home/lxusers/k/kalindigosine/snrlab-ic-q-pix-v1/chip_network_sim/build/larpix_2x2_packet_loss_probe_v3c2/chip0_rx_debug.csv)
- [packet_loss_summary.json](/home/lxusers/k/kalindigosine/snrlab-ic-q-pix-v1/chip_network_sim/build/larpix_2x2_packet_loss_probe_v3c2/packet_loss_summary.json)
- saved visualizer playback snapshot: [live_event_2x2_packet_loss_probe_v3c2_edit1_rx_process_to_idle.json](/home/lxusers/k/kalindigosine/snrlab-ic-q-pix-v1/chip_network_sim/larpix_network_sim/visualizers/packet_transmission/playback/live_event_2x2_packet_loss_probe_v3c2_edit1_rx_process_to_idle.json)
- saved visualizer Chip 0 sidecar: [chip0_rx_debug.csv](/home/lxusers/k/kalindigosine/snrlab-ic-q-pix-v1/chip_network_sim/larpix_network_sim/visualizers/packet_transmission/playback/larpix_2x2_packet_loss_probe_v3c2_edit1_rx_process_to_idle/chip0_rx_debug.csv)

Observed result:

- chip `0` receives all `64` north packets and all `64` east packets
- chip `0` forwards only `64` packets onward
- FPGA sees only chip `1`
  - unique packets from chip `1`: `32`
  - total arrivals from chip `1`: `64`

Interpretation:

- the surviving source stream changes
- total forwarded traffic does not improve
- this first fix changes which lane wins the mismatch, but does not remove the deeper shared-path corruption by itself

## `v3c2` Edit 2: `comms_ctrl` `LOAD_FIFO` Uses `rcvd_pkt`

The second isolated `v3c2` change keeps the first Hydra fix in place and then changes the `comms_ctrl` pass-through path so `read_pkt` is built from the latched packet captured in `IDLE`, rather than from the live `rx_data` bus.

File and changed lines:

- [`larpix_network_sim/larpix_v3c2/src/comms_ctrl.sv`](/home/lxusers/k/kalindigosine/snrlab-ic-q-pix-v1/chip_network_sim/larpix_network_sim/larpix_v3c2/src/comms_ctrl.sv:238)

Current `v3c2` lines `238-241` after Edit 2:

```systemverilog
                if ((rcvd_pkt[9:2] != chip_id) || 
                        (rcvd_pkt[9:2] == GLOBAL_ID) ||
                        rcvd_pkt[1:0] == DATA_OP) begin
                        read_pkt <= rcvd_pkt[WIDTH-2:0];
```

This transaction-consistency fix removes the direct dependence on live `rx_data` while `LOAD_FIFO` is building the packet that will be handed back to Hydra. Looking at the chip 0 state after edit 1 was applied, we see that data packets from the east chip do now enter Comms Ctrl. The issue is that `rcvd_pkt` hold the north data packet (which was read first) and the state `read_pkt` is then loaded with the east data packet (which was read second) but the `LOAD_FIFO` action loads the east packet (stored in `read_pkt`) first which is not correct behavior. You can see this on ticks 1085-1089 of the playback for Edit1. The reason for this behavior is that `read_pkt` is updated from `rx_data` state in the Hydra Ctrl which, by the time the FIFO is ready to receive from Comms Ctrl, has already been overwritten by the east packet. The fix with Edit2 is to have the `read_pkt` state be built from the latched `rcvd_pkt` rather than the live `rx_data` state. You can then see in the playback for the Edit2 case in the visualizer that for the same ticks 1085-1089, `read_pkt` is the same as `rcvd_pkt` and are both the north packet. 

### Result

Artifacts:

- [run.log](/home/lxusers/k/kalindigosine/snrlab-ic-q-pix-v1/chip_network_sim/build/larpix_2x2_packet_loss_probe_v3c2_edit2/run.log)
- [trace.jsonl](/home/lxusers/k/kalindigosine/snrlab-ic-q-pix-v1/chip_network_sim/build/larpix_2x2_packet_loss_probe_v3c2_edit2/trace.jsonl)
- [chip0_rx_debug.csv](/home/lxusers/k/kalindigosine/snrlab-ic-q-pix-v1/chip_network_sim/build/larpix_2x2_packet_loss_probe_v3c2_edit2/chip0_rx_debug.csv)
- [packet_loss_summary.json](/home/lxusers/k/kalindigosine/snrlab-ic-q-pix-v1/chip_network_sim/build/larpix_2x2_packet_loss_probe_v3c2_edit2/packet_loss_summary.json)
- saved visualizer playback snapshot: [live_event_2x2_packet_loss_probe_v3c2_edit2_hydra_idle_plus_comms_rcvdpkt.json](/home/lxusers/k/kalindigosine/snrlab-ic-q-pix-v1/chip_network_sim/larpix_network_sim/visualizers/packet_transmission/playback/live_event_2x2_packet_loss_probe_v3c2_edit2_hydra_idle_plus_comms_rcvdpkt.json)
- saved visualizer Chip 0 sidecar: [chip0_rx_debug.csv](/home/lxusers/k/kalindigosine/snrlab-ic-q-pix-v1/chip_network_sim/larpix_network_sim/visualizers/packet_transmission/playback/larpix_2x2_packet_loss_probe_v3c2_edit2_hydra_idle_plus_comms_rcvdpkt/chip0_rx_debug.csv)

Observed result:

- chip `0` receives all `64` north packets and all `64` east packets
- chip `0` forwards only `64` packets onward
- FPGA still sees only chip `1`
  - unique packets from chip `1`: `32`
  - total arrivals from chip `1`: `64`

Comparison with Edit 1:

- no network-level change yet
- this fix improves internal transaction consistency but is not sufficient by itself

## `v3c2` Edit 3: `pkt_data` Uses `read_pkt`

The third isolated `v3c2` change keeps the first two fixes in place and then removes the final live-bus bypass in `comms_ctrl`. Instead of letting the FIFO write path choose between corrected `read_pkt` and live `rx_data`, it now always sends the packet assembled in `read_pkt`.

File and changed lines:

- [`larpix_network_sim/larpix_v3c2/src/comms_ctrl.sv`](/home/lxusers/k/kalindigosine/snrlab-ic-q-pix-v1/chip_network_sim/larpix_network_sim/larpix_v3c2/src/comms_ctrl.sv:140)

Current `v3c2` lines `140-142` after Edit 3:

```systemverilog
    // calculate parity
always_comb
    pkt_data = {~^read_pkt, read_pkt};
```

### Exact Issue This Edit Addresses

This edit targets the specific mismatch where `read_pkt` had already been corrected by Edit2, but the actual FIFO write data could still come from the live `rx_data` bus.

In other words:

- `read_pkt` could describe the right packet transaction
- but `pkt_data` could still inject the wrong lane's packet into the Hydra FIFO

You see this behavior in the Edit2 visualizer at ticks 1086-1087 where although in Comms Ctrl, `read_pkt` is the north packet, the fifo memory first position is filled with the east packet. This is because the v3c RTL defines that FIFO load is again based on a stale `rx_data` state. This bug seems to have been addressed on 5/5/26 in commit 12eee5b to the v3c repo. This test was done on RTL pulled on 04/29/2026. 

### Result

Artifacts:

- [run.log](/home/lxusers/k/kalindigosine/snrlab-ic-q-pix-v1/chip_network_sim/build/larpix_2x2_packet_loss_probe_v3c2_edit3/run.log)
- [trace.jsonl](/home/lxusers/k/kalindigosine/snrlab-ic-q-pix-v1/chip_network_sim/build/larpix_2x2_packet_loss_probe_v3c2_edit3/trace.jsonl)
- [chip0_rx_debug.csv](/home/lxusers/k/kalindigosine/snrlab-ic-q-pix-v1/chip_network_sim/build/larpix_2x2_packet_loss_probe_v3c2_edit3/chip0_rx_debug.csv)
- [packet_loss_summary.json](/home/lxusers/k/kalindigosine/snrlab-ic-q-pix-v1/chip_network_sim/build/larpix_2x2_packet_loss_probe_v3c2_edit3/packet_loss_summary.json)
- saved visualizer playback snapshot: [live_event_2x2_packet_loss_probe_v3c2_edit3_plus_pktdata_readpkt.json](/home/lxusers/k/kalindigosine/snrlab-ic-q-pix-v1/chip_network_sim/larpix_network_sim/visualizers/packet_transmission/playback/live_event_2x2_packet_loss_probe_v3c2_edit3_plus_pktdata_readpkt.json)
- saved visualizer Chip 0 sidecar: [chip0_rx_debug.csv](/home/lxusers/k/kalindigosine/snrlab-ic-q-pix-v1/chip_network_sim/larpix_network_sim/visualizers/packet_transmission/playback/larpix_2x2_packet_loss_probe_v3c2_edit3_plus_pktdata_readpkt/chip0_rx_debug.csv)

Observed result:

- chip `0` receives all `64` north packets and all `64` east packets
- chip `0` still forwards only `64` packets onward
- FPGA now sees both sources:
  - unique packets from chip `1`: `32`
  - unique packets from chip `2`: `32`
  - total arrivals from chip `1`: `32`
  - total arrivals from chip `2`: `32`

Comparison with Edit 2:

- total forwarded traffic is still `64`
- but the winner-take-all symptom is gone
- both sources are now represented at the FPGA

## `v3c2` Edit 4: Hydra TX Scheduling Fix

The fourth isolated `v3c2` change keeps the first three fixes in place and then changes Hydra TX scheduling so the controller no longer parks in `TX_GET_FIFO` while the downstream UART is already busy.

Files and changed lines:

- [`larpix_network_sim/larpix_v3c2/src/hydra_ctrl.sv`](/home/lxusers/k/kalindigosine/snrlab-ic-q-pix-v1/chip_network_sim/larpix_network_sim/larpix_v3c2/src/hydra_ctrl.sv:157)
- [`larpix_network_sim/larpix_v3c2/src/hydra_ctrl.sv`](/home/lxusers/k/kalindigosine/snrlab-ic-q-pix-v1/chip_network_sim/larpix_network_sim/larpix_v3c2/src/hydra_ctrl.sv:174)

Current `v3c2` lines `157-160` and `174-176` after Edit 4:

```systemverilog
        IDLE: 
            if (|uart_has_data)             Next = RX_CAPTURE;
            else if (!fifo_empty && ((tx_busy & enable_piso_downstream) == '0))
                                            Next = TX_GET_FIFO;
```

```systemverilog
        TX_GET_FIFO: 
            if ((tx_busy & enable_piso_downstream) != '0) Next = IDLE; 
            else                            Next = TX_SEND;   
```

### Exact Issue This Edit Addresses

This edit targets the scheduling bug where Hydra could spend roughly a full UART frame time stalled in `TX_GET_FIFO` while a previous packet was still being serialized.

In that stalled state:

- Hydra was not launching a new transmit, because TX was busy
- but Hydra was also not returning to `IDLE` to keep servicing RX-side work

So even after the `comms_ctrl` transaction fixes, RX-side progress could still be throttled simply because Hydra was parked waiting on TX. Edit 4 makes TX launch opportunistic instead of blocking:

- only enter `TX_GET_FIFO` when the downstream TX lane is free
- if TX becomes busy, fall back to `IDLE` instead of waiting there

### Result

Artifacts:

- [run.log](/home/lxusers/k/kalindigosine/snrlab-ic-q-pix-v1/chip_network_sim/build/larpix_2x2_packet_loss_probe_v3c2_edit4/run.log)
- [trace.jsonl](/home/lxusers/k/kalindigosine/snrlab-ic-q-pix-v1/chip_network_sim/build/larpix_2x2_packet_loss_probe_v3c2_edit4/trace.jsonl)
- [chip0_rx_debug.csv](/home/lxusers/k/kalindigosine/snrlab-ic-q-pix-v1/chip_network_sim/build/larpix_2x2_packet_loss_probe_v3c2_edit4/chip0_rx_debug.csv)
- [packet_loss_summary.json](/home/lxusers/k/kalindigosine/snrlab-ic-q-pix-v1/chip_network_sim/build/larpix_2x2_packet_loss_probe_v3c2_edit4/packet_loss_summary.json)
- longer-tail run log: [run.log](/home/lxusers/k/kalindigosine/snrlab-ic-q-pix-v1/chip_network_sim/build/larpix_2x2_packet_loss_probe_v3c2_edit4_longtail/run.log)
- longer-tail trace: [trace.jsonl](/home/lxusers/k/kalindigosine/snrlab-ic-q-pix-v1/chip_network_sim/build/larpix_2x2_packet_loss_probe_v3c2_edit4_longtail/trace.jsonl)
- longer-tail summary: [packet_loss_summary.json](/home/lxusers/k/kalindigosine/snrlab-ic-q-pix-v1/chip_network_sim/build/larpix_2x2_packet_loss_probe_v3c2_edit4_longtail/packet_loss_summary.json)
- saved visualizer playback snapshot: [live_event_2x2_packet_loss_probe_v3c2_edit4_plus_hydra_tx_schedule_longtail.json](/home/lxusers/k/kalindigosine/snrlab-ic-q-pix-v1/chip_network_sim/larpix_network_sim/visualizers/packet_transmission/playback/live_event_2x2_packet_loss_probe_v3c2_edit4_plus_hydra_tx_schedule_longtail.json)
- saved visualizer Chip 0 sidecar: [chip0_rx_debug.csv](/home/lxusers/k/kalindigosine/snrlab-ic-q-pix-v1/chip_network_sim/larpix_network_sim/visualizers/packet_transmission/playback/larpix_2x2_packet_loss_probe_v3c2_edit4_plus_hydra_tx_schedule_longtail/chip0_rx_debug.csv)

Observed result:

- chip `0` receives all `64` north packets and all `64` east packets
- chip `0` now forwards all `128` packets onward
- FPGA sees both sources:
  - unique packets from chip `1`: `64`
  - unique packets from chip `2`: `64`
  - total arrivals from chip `1`: `64`
  - total arrivals from chip `2`: `64`

The earlier shorter Edit 4 run undercounted FPGA-visible packets because the drain window was too short. Re-running the same 4-edit RTL with an additional `10000` ticks of drain tail shows that the `2x2` case now drains completely.

### Comparison With Edit 3

Relative to Edit 3, Edit 4 improves both total forwarding throughput and the FPGA-visible packet count.

- Edit 3:
  - chip `0` TX count: `64`
  - FPGA sees chip `1`: `32`, chip `2`: `32`
- Edit 4:
  - chip `0` TX count: `128`
  - FPGA sees chip `1`: `64`, chip `2`: `64`

So Edit 4 is the first change in the `v3c2` sequence that restores full `128`-packet forwarding in the `2x2` case, once the run is given enough drain time. This confirms that Hydra TX self-blocking was the real remaining limiter after the first three fixes.
