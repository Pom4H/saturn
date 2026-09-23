import { BunTcpChannel, type BunTcpChannelOptions } from './bun-tcp';

const u16 = (buffer: Uint8Array, offset: number) => (buffer[offset] << 8) | buffer[offset + 1];
const put16 = (buffer: Uint8Array, offset: number, value: number) => {
    buffer[offset] = (value >>> 8) & 0xff;
    buffer[offset + 1] = value & 0xff;
};

export interface ModbusTcpOptions extends BunTcpChannelOptions {
    unitId?: number;
}

export class ModbusTcpClient {
    private tx = 0;
    private readonly channel: BunTcpChannel;
    readonly unitId: number;

    constructor(options: ModbusTcpOptions) {
        this.unitId = options.unitId ?? 1;
        if (!Number.isInteger(this.unitId) || this.unitId < 0 || this.unitId > 247) throw new Error('Invalid Modbus unit id');
        this.channel = new BunTcpChannel({ ...options, maxFrameBytes: Math.min(options.maxFrameBytes ?? 4096, 4096) });
    }

    private async request(functionCode: number, payload: Uint8Array, unit = this.unitId): Promise<Uint8Array> {
        const transaction = this.tx = (this.tx + 1) & 0xffff;
        const request = new Uint8Array(8 + payload.byteLength);
        put16(request, 0, transaction);
        put16(request, 2, 0);
        put16(request, 4, 2 + payload.byteLength);
        request[6] = unit;
        request[7] = functionCode;
        request.set(payload, 8);

        const frame = await this.channel.exchange(request, buffer => {
            if (buffer.byteLength < 6) return null;
            const length = u16(buffer, 4);
            if (length < 2 || length > 260) throw new Error('Invalid Modbus TCP length');
            return 6 + length;
        });

        if (u16(frame, 0) !== transaction) throw new Error('Modbus transaction mismatch');
        if (u16(frame, 2) !== 0) throw new Error('Invalid Modbus protocol id');
        if (frame[6] !== unit) throw new Error('Modbus unit mismatch');
        const responseFunction = frame[7];
        if (responseFunction === (functionCode | 0x80))
            throw new Error(`Modbus exception ${frame[8] ?? 0}`);
        if (responseFunction !== functionCode) throw new Error('Modbus function mismatch');
        return frame.subarray(8);
    }

    private async readRegisters(functionCode: 3 | 4, address: number, count: number, unit?: number): Promise<number[]> {
        if (!Number.isInteger(address) || address < 0 || address > 0xffff) throw new Error('Invalid Modbus address');
        if (!Number.isInteger(count) || count < 1 || count > 125) throw new Error('Invalid Modbus register count');
        const payload = new Uint8Array(4);
        put16(payload, 0, address);
        put16(payload, 2, count);
        const response = await this.request(functionCode, payload, unit);
        if (response[0] !== count * 2 || response.byteLength !== 1 + count * 2)
            throw new Error('Invalid Modbus register response');
        return Array.from({ length: count }, (_, index) => u16(response, 1 + index * 2));
    }

    readHoldingRegisters(address: number, count: number, unit?: number): Promise<number[]> {
        return this.readRegisters(3, address, count, unit);
    }

    readInputRegisters(address: number, count: number, unit?: number): Promise<number[]> {
        return this.readRegisters(4, address, count, unit);
    }

    async writeSingleRegister(address: number, value: number, unit?: number): Promise<void> {
        if (!Number.isInteger(address) || address < 0 || address > 0xffff) throw new Error('Invalid Modbus address');
        if (!Number.isInteger(value) || value < 0 || value > 0xffff) throw new Error('Invalid Modbus register value');
        const payload = new Uint8Array(4);
        put16(payload, 0, address);
        put16(payload, 2, value);
        const response = await this.request(6, payload, unit);
        if (response.byteLength !== 4 || u16(response, 0) !== address || u16(response, 2) !== value)
            throw new Error('Invalid Modbus write acknowledgement');
    }

    close(): void { this.channel.close(); }
}
