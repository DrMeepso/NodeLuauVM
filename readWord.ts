import { OpCodeNames, OpCodeModes } from "./OpCodes"; // Import the generated OpCodeNames and OpCodeModes arrays

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

export function HasAux(opcode: number)
{
    let OpMode: number = OpCodeModes[opcode];
    if (OpMode == undefined)
    {
        console.warn("Invalid opcode " + opcode);
        return false;
    }
    return ((OpMode & 0b0000001) == 0b0000001) || ((OpMode & 0b0000010) == 0b0000010);
}

export function ReadOpCode(word: Buffer)
{
    let opCode = word.readUInt8(0);

    console.log("Opcode: " + OpCodeNames[opCode], "Mode: " + OpMode[OpCodeModes[opCode]>>2]);

    let OpCodeArguments = {
        "A": undefined,
        "B": undefined,
        "C": undefined,
        "D": undefined,
        "E": undefined,
    };
}