# Saturn HMI showcase

Standalone fictional booster skid for demonstrating the 320×240 physical HMI shell.

## Run

    npm run plant:showcase

Open `http://127.0.0.1:4177/plant/`.

Local demo login: `engineer / showcase-demo-2026`. This credential exists only in the local showcase runner.

## Process

    TK-101 → P-101 → F-101 → V-101 → AC-101
                ↑
            SATURN-DEMO

The project also includes LT-101, PT-101, an RS-485 I/O expansion and a run indicator.

The process is deliberately fictional and uses normalized units. It exists to exercise the compact four-key HMI, topology-derived equipment pages, contextual START/STOP and OPEN/CLOSE commands, Firmverse-driven animation, I/O diagnostics and network visualization.

## Shell interaction

HOME: RIGHT opens equipment, UP opens network, DOWN opens I/O diagnostics.

EQUIPMENT: LEFT returns home, RIGHT moves to the next equipment, UP/DOWN become contextual START/STOP or OPEN/CLOSE when that object has a PLC setpoint.

The top bar is 18 px and the bottom hint strip is 16 px. The remaining 206 px are process content.

## Video

    npm run plant:showcase:video

CI uses `ru-RU-DmitryNeural` through edge-tts and falls back to `espeak-ng`. The final artifact is H.264/AAC MP4.
