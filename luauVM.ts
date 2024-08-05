import { OpCodeNames, OpCodeModes } from "./OpCodes"; // Import the generated OpCodeNames and OpCodeModes arrays
import { BinaryReader } from "./binaryReader";
import { HasAux, ReadOpCode, type Instruction } from "./readWord";

interface Proto {

    MaxStackSize: number;
    NumParams: number;
    NumUpvalues: number; // number of upvalues, not including the upvalue of the function itself
    IsVararg: number; // 0 = fixed number of arguments, 1 = vararg function
    LineDefined: number; // first line of the function definition
    DebugName: string; // name of the function

    NumInstructions: number;
    Instructions: Array<Instruction>;

    NumConstants: number;
    Constants: Array<any>;

    NumProtos: number;
    Protos: Array<Number>;

    LineInfoEnabled: boolean;
    InstructionInfo: number[];

    ByteCodeID: number;

}

interface Constant {
    type: number;
    value: any;
}

interface LocateVariable {
    name: string;
    start: number;
    end: number;
    register: number;
}

function ReadProto(reader: BinaryReader, ByteCodeID: number, StringArray: Array<string>)
{
    let MaxStackSize = reader.readByte(); // maximum stack size for that proto
    let NumParams = reader.readByte(); // number of parameters
    let NumUpvalues = reader.readByte(); // number of upvalues
    let IsVararg = reader.readByte(); // is the function vararg?

    // we are higher than version 4 of luau!
    let Flags = reader.readByte(); // flags
    let UserTypesCount = reader.readVarInt(); // we are not going to read the user types for now
    reader.pointer += UserTypesCount; // skip the user types

    let NumInstructions = reader.readVarInt(); // Code Size
    let Instructions: Array<Instruction> = [];
    for (let i = 0; i < NumInstructions; i++)
    {
        let word = reader.readWord();
        let hasAUX = HasAux(word & 0b1111111);
        let aux: number = 0;
        if (hasAUX) {
            aux = reader.readWord();
            i++;
        }
        let buff = Buffer.alloc(8);
        buff.writeUInt32LE(word);
        if (hasAUX) {
            buff.writeUInt32LE(aux, 4);
        }
        let inst = ReadOpCode(buff);
        Instructions.push(inst);
    }

    //console.log("Instructions: " + Instructions);

    let NumConstants = reader.readVarInt(); // number of constants
    let Constants: Array<Constant> = [];
    //console.log("NumConstants: " + NumConstants);
    function addConstant(type: number, value: any)
    {
        Constants.push({type: type, value: value});
    }

    for (let i = 0; i < NumConstants; i++)
    {
        let type = reader.readByte();
        switch (type)
        {
            case 0: // nil
                addConstant(0, null);
                break;
            case 1: // bool
                addConstant(1, reader.readByte() != 0);
                break;
            case 2: // number
                addConstant(2, reader.readDouble());
                break;
            case 3: // string
                let stringIndex = reader.readVarInt();
                addConstant(3, StringArray[stringIndex-1]);
                break;
            case 4: // import?
                let world = reader.readWord();
                addConstant(4, world);
                break;
            case 5: // table
                let tableSize = reader.readVarInt();
                let table: number[] = [];
                for (let i = 0; i < tableSize; i++)
                {
                    table[i] = reader.readVarInt();
                }
                addConstant(5, table);
                break;
            case 6: // closure / function
                addConstant(6, reader.readVarInt());
                break;
            case 7: // vector
                console.log("Why is there a vector?")
                break;
            default:
                console.error("Invalid constant type: " + type);
                break;
        }
    }

    console.log("Constants: ",Constants);

    let NumProtos = reader.readVarInt(); // number of nested functions
    let Protos: Array<Number> = [];

    for (let i = 0; i < NumProtos; i++)
    {
        Protos.push(reader.readVarInt() + 1); // read the index of the nested function
    }

    let LineDefined = reader.readVarInt(); // first line of the function definition

    let DebugNameIndex = reader.readVarInt(); // name of the function
    if (DebugNameIndex == 0)
    {
        //console.log("Function name: (none)");
    } else {
        //console.log("Function name: " + StringArray[DebugNameIndex-1]);
    }

    let LineInfoEnabled = reader.readByte() != 0; // is line info enabled?
    //console.log("Line info enabled: " + LineInfoEnabled);
    let InstructionInfo: number[] = [];
    if (LineInfoEnabled)
    {
        let linegaplog2 = reader.readByte();

        let intervals = ((NumInstructions - 1) >> linegaplog2) + 1;

        let lineInfo: number[] = []
        let asbLineInfo: number[] = []

        let lastOffset  = 0
        for (let i = 0; i < NumInstructions; i++)
        {
            lastOffset = reader.readByte();
            lineInfo[i] = lastOffset;
        }

        let lastLine = 0;
        for (let i = 0; i < intervals; i++)
        {
            lastLine += reader.readWord();
            asbLineInfo[i] = lastLine % Math.pow(2, 32)
        }

        for (let i = 0; i < NumInstructions; i++)
        {
            InstructionInfo.push(asbLineInfo[(i - 1) >> linegaplog2] + lineInfo[i]);
        }

    }

    // debug info
    if (reader.readByte() != 0)
    {
        console.log("Debug info is enabled");
        let LocateVariableCount = reader.readVarInt();
        let LocateVariables: Array<LocateVariable> = [];

        for (let i = 0; i < LocateVariableCount; i++)
        {
            let name = StringArray[reader.readVarInt()-1];
            let start = reader.readVarInt();
            let end = reader.readVarInt();
            let register = reader.readByte();
            LocateVariables.push({name: name, start: start, end: end, register: register});
        }

        console.log("Locate variables: ",LocateVariables);

        let sizeUpvalues = reader.readVarInt();
        let Upvalues: Array<number> = [];
        for (let i = 0; i < sizeUpvalues; i++)
        {
            Upvalues.push(reader.readVarInt());
        }

    } else {
        //console.log("Debug info is disabled");
    }

    let Proto: Proto = {
        MaxStackSize: MaxStackSize,
        NumParams: NumParams,
        NumUpvalues: NumUpvalues,
        IsVararg: IsVararg,
        LineDefined: LineDefined,
        DebugName: StringArray[DebugNameIndex-1],
        NumInstructions: NumInstructions,
        Instructions: Instructions,
        NumConstants: NumConstants,
        Constants: Constants,
        NumProtos: NumProtos,
        Protos: Protos,
        LineInfoEnabled: LineInfoEnabled,
        InstructionInfo: InstructionInfo,
        ByteCodeID: ByteCodeID
    }

    return Proto;

}


export function RunLuau(source: Buffer)
{
    const reader = new BinaryReader(source);

    let luauVersion = reader.readByte();
    let typesVersion = 0; // only used after luau version 4
    if (luauVersion >= 4)
    {
        typesVersion = reader.readByte();
        console.log("Types version: " + typesVersion);
    } else {
        console.error("Unsupported Luau version: " + luauVersion + ", please use version 4 or higher");
    }
    console.log("Luau version: " + luauVersion);

    // read the amount of strings that are in the bytecode
    let stringCount = reader.readVarInt();
    //console.log("String count: " + stringCount);

    const stringTable: Array<string> = [];
    for (let i = 0; i < stringCount; i++)
    {
        stringTable.push(reader.readString());
        //console.log("String: " + stringTable[i]);
    }

    // For custom userdata, we are not going to read them because we dont need them for now.
    if (typesVersion == 3){
        let Index = reader.readByte();
        while (Index != 0) {
            reader.readVarInt();
            Index = reader.readByte();
        }
    }

    let protoCount = reader.readVarInt();
    console.log("Proto count: " + protoCount);
    let Protos: Array<Proto> = [];
    for (let i = 0; i < protoCount; i++)
    {
        Protos.push(ReadProto(reader, i, stringTable));
        console.log("Proto:", Protos[i].DebugName || "(??)");
    }

    let MainProtoIndex = reader.readVarInt();
    console.log("Main proto index: " + MainProtoIndex);
    let MainProto = Protos[MainProtoIndex];

}