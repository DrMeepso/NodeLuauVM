export class BinaryReader {

    binaryBuffer: Buffer;
    pointer: number;

    constructor(binaryBuffer: Buffer) {
        this.binaryBuffer = binaryBuffer;
        this.pointer = 0;
    }

    readByte(): number
    {
        return this.binaryBuffer.readUInt8(this.pointer++);
    }
    readWord(): number // u32
    {
        let v = this.binaryBuffer.readUInt32LE(this.pointer);
        this.pointer += 4;
        return v;
    }
    readFloat(): number // f32
    {
        let v = this.binaryBuffer.readFloatLE(this.pointer);
        this.pointer += 4;
        return v;
    }
    readDouble(): number // f64
    {
        let v = this.binaryBuffer.readDoubleLE(this.pointer);
        this.pointer += 8;
        return v;
    }
    readVarInt(): number
    {
        let v = 0;
        let shift = 0;
        let b: number;
        do {
            b = this.readByte();
            v |= (b & 0x7F) << shift;
            shift += 7;
        } while (b >= 0x80);
        return v;
    }
    readString(): string
    {
        let length = this.readVarInt();
        let str = this.binaryBuffer.toString("utf-8", this.pointer, this.pointer + length);
        this.pointer += length;
        return str;
    }

}