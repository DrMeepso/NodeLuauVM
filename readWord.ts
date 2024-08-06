import { OpCodeNames, OpCodeModes } from "./OpCodes"; // Import the generated OpCodeNames and OpCodeModes arrays

const logOpCodes = false;
const logOpModes = false;

enum OpMode {
    None = 0b00000,
    A = 0b10000,
    AB = 0b11000,
    AC = 0b10100,
    ABC = 0b11100,
    AD = 0b10010,
    D = 0b00010,
    //AE = 0b10001,
    E = 0b00001,
}

export interface Instruction {
    A: number | undefined;
    B: number | undefined;
    C: number | undefined;
    D: number | undefined;
    E: number | undefined;
    Aux: Buffer | undefined;
    OpCode: number;
}

export function HasAux(opcode: number)
{
    let OpMode: number = OpCodeModes[opcode];
    if (OpMode == undefined)
    {
        console.warn("Invalid opcode " + opcode);
        return false;
    }
    return ((OpMode & 0b0000010) == 0b0000010);
}

export function ReadOpCode(word: Buffer): Instruction
{
    let opCode = word.readUInt8(0);

    if (logOpCodes)
        console.log("Opcode: " + OpCodeNames[opCode], "Mode: " + OpMode[OpCodeModes[opCode]>>2]);

    // ABC
    // AD
    function InsA(): number {
        return word.readUInt8(1);
    }
    // b is always behind a and c
    function InsB(): number {
        return word.readUInt8(2);
    }
    function InsC(): number {
        return word.readUInt8(3);
    }
    // d is a 16-bit value, its behind a
    // AD mode
    function InsD(): number {
        return word.readInt16LE(2);
    }
    // E - least-significant byte for the opcode, followed by E (24-bit integer). E is a signed integer that commonly specifies a jump offset
    // E
    function InsE(): number {
        let first8 = word.readUInt8(1);
        let last16 = word.readInt16LE(2);
        return (last16 << 8) | first8;
    }

    let A,B,C,D,Aux
    switch(true)
    {
        case OpMode[OpCodeModes[opCode]>>2] == "A":
            A = InsA();
            if (logOpModes)
                console.log("A: " + A);
            break;
        case OpMode[OpCodeModes[opCode]>>2] == "AB":
            A = InsA();
            B = InsB();
            if (logOpModes)
                console.log("A: " + A, "B: " + B);
            break;
        case OpMode[OpCodeModes[opCode]>>2] == "AC":
            A = InsA();
            C = InsC();
            if (logOpModes)
                console.log("A: " + A, "C: " + C);
            break;
        case OpMode[OpCodeModes[opCode]>>2] == "ABC":
            A = InsA();
            B = InsB();
            C = InsC();
            if (logOpModes)
                console.log("A: " + A, "B: " + B, "C: " + C);
            break;
        case OpMode[OpCodeModes[opCode]>>2] == "AD":
            A = InsA();
            D = InsD();
            if (logOpModes)
                console.log("A: " + A, "D: " + D);
            break;
        case OpMode[OpCodeModes[opCode]>>2] == "D":
            D = InsD();
            if (logOpModes)
                console.log("D: " + D);
            break;
        case OpMode[OpCodeModes[opCode]>>2] == "E":
            D = InsE();
            if (logOpModes)
                console.log("E: " + D);
            break;
        case OpMode[OpCodeModes[opCode]>>2] == "None":
            break;
        default:
            console.warn("Error reading OpCode words" + OpCodeNames[opCode]);
            break;
    }

    if (HasAux(opCode))
    {
        // slice buffer
        Aux = word.slice(4, 8);
        if (logOpModes)
            console.log("Aux:", Aux);
    }

    return {
        A: A,
        B: B,
        C: C,
        D: D,
        E: D,
        Aux: Aux,
        OpCode: opCode
    } as Instruction;
}