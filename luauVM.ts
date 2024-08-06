import { OpCodeNames, OpCodeModes, OpCode } from "./OpCodes"; // Import the generated OpCodeNames and OpCodeModes arrays
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

interface LocateVariable {
    name: string;
    start: number;
    end: number;
    register: number;
}

// implement later
//type Closure = {}

// any type that is possible in lua
type LuaType = string | number | boolean | null | LuaTable | Closure;

type LuaTable = Map<LuaType, LuaType>;

enum StackType {
    Nil = 0,
    Bool = 1,
    Number = 2,
    String = 3,
    Table = 4,
    Closure = 5,
    Vector = 6,
    Import = 7 // still dont know what this dose
}

interface StackValue {
    type: StackType;
    value: LuaType;
}

type ImportTable = { [key: string]: Closure | ImportTable };

interface Program {
    Protos: Array<Proto>;
    MainProto: number;
    GlobalEnv: Map<string, StackValue>; // global environment of the program, getenv and setenv
    Imports: ImportTable;
}

interface UpValue {
    isRef: boolean;
}
interface UpValueRef extends UpValue {
    isRef: true; // the value is stored in another stack!
    index: number;
    store: StackValue[]; // the stack the index is from
}
interface UpValueAbs extends UpValue {
    isRef: false; // the value is stored in the upvalue
    value: StackValue;
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
    //console.log("Num instructions: " + NumInstructions);
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

    //console.log("Instructions: ", Instructions);

    let NumConstants = reader.readVarInt(); // number of constants
    //console.log("NumConstants: " + NumConstants);
    let Constants: Array<StackValue> = [];
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
                addConstant(StackType.Nil, null);
                break;
            case 1: // bool
                addConstant(StackType.Bool, reader.readByte() != 0);
                break;
            case 2: // number
                addConstant(StackType.Number, reader.readDouble());
                break;
            case 3: // string
                let stringIndex = reader.readVarInt();
                addConstant(StackType.String, StringArray[stringIndex-1]);
                break;
            case 4: // import - i dont know what this is for
                let world = reader.readWord();
                addConstant(StackType.Import, world);
                break;
            case 5: // table
                let tableSize = reader.readVarInt();
                let table: LuaTable = new Map();
                for (let i = 0; i < tableSize; i++)
                {
                    table.set(table.size, reader.readVarInt());
                }
                addConstant(StackType.Table, table);
                break;
            case 6: // closure / function
                addConstant(StackType.Closure, reader.readVarInt());
                break;
            case 7: // vector
                console.log("Why is there a vector?")
                break;
            default:
                console.error("Invalid constant type: " + type);
                break;
        }
    }

    //console.log("Constants: ",Constants);

    let NumProtos = reader.readVarInt(); // number of nested functions
    let Protos: Array<Number> = [];

    for (let i = 0; i < NumProtos; i++)
    {
        Protos.push(reader.readVarInt()); // read the index of the nested function
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

// implement later
export function WrapClosure(lclosure: Closure): (...args: any[]) => any[] {
    return (...args: any[]) => {return [""]};
}

enum ClosureType {
    NODE = "NODE",
    LUA = "LUA"
}

interface Closure {
    type: ClosureType;
    Call(...args: StackValue[]): Promise<StackValue[]>;
}
class NodeClosure implements Closure {
    type = ClosureType.NODE;
    async Call(...args: StackValue[]): Promise<StackValue[]> {
        return args;
    }
    LuaArgsToNodeArgs(args: StackValue[]): any[] {
        return args.map((arg) => { return arg.value });
    }
    luaTypeFromNodeValue(value: any): StackValue {
        if (value == null) return {type: StackType.Nil, value: null};
        if (typeof value == "boolean") return {type: StackType.Bool, value: value};
        if (typeof value == "number") return {type: StackType.Number, value: value};
        if (typeof value == "string") return {type: StackType.String, value: value};
        if (value instanceof Map) return {type: StackType.Table, value: value};
        if (value.type == ClosureType.LUA || value.type == ClosureType.NODE) return {type: StackType.Closure, value: value};

        return {type: StackType.Nil, value: null}; // we dont know what it is :/
    }
    NodeArgsToLuaArgs(args: any[]): StackValue[] {
        return args.map((arg) => { return this.luaTypeFromNodeValue(arg) });
    }
}

// the print function for lua, not warped because i want the "LVM:OUT >" prefix :)
let nodePrint = new class Print extends NodeClosure {
    type = ClosureType.NODE;
    async Call(...args: StackValue[]): Promise<StackValue[]> {
        console.log("LVM:OUT >", this.LuaArgsToNodeArgs(args))
        return args;
    }
}

// wrap a nodejs native function in a closure class so lua can call it!
export function wrapNodeFunction(f: (...args: any[]) => any[]) {
    let newClosure = new NodeClosure();
    newClosure.Call = function(...args: StackValue[]): Promise<StackValue[]> {
        return new Promise((resolve, reject) => {
            let nodeArgs = newClosure.LuaArgsToNodeArgs(args);
            let nodeReturn = f(...nodeArgs);
            resolve(newClosure.NodeArgsToLuaArgs(nodeReturn));
        });
    }
    return newClosure;
}

// a closure containing lua bytecode
class LuaClosure implements Closure {

    type: ClosureType = ClosureType.LUA;

    parentProgram: Program;
    baseProto: Proto;
    // need a upvalue type / interface
    //upvalues: Array<LuaType>; //  an array of any type of lua value
    registers: Array<StackValue>;
    childProtos: Array<Number>;

    pointer = 0; // the current instruction that is being executed
    code: Array<Instruction>; // the bytecode of the closure

    upValues: Map<number, UpValue>;
    myUpValues: Map<number, UpValue>; // up values that refer to things in this closure, upvals for functions called inside this closure

    constructor(parentProgram: Program, Proto: number, Upvalues: Map<number, UpValue>)
    {
        this.parentProgram = parentProgram;
        this.baseProto = parentProgram.Protos[Proto];
        this.registers = new Array<StackValue>();
        this.childProtos = this.baseProto.Protos;
        this.code = this.baseProto.Instructions;
        this.upValues = Upvalues;
        this.myUpValues = new Map<number, UpValue>(); // up values that refer to things in this closure, upvals for functions called inside this closure
        //this.upvalues = Upvalues;
    }

    runInstruction()
    {
        if (this.pointer >= this.code.length)
        {
            console.error("Program counter is out of bounds");
            return;
        }
        let instruction = this.code[this.pointer];

        switch(instruction.OpCode)
        {
            case OpCode.NOP: // no operation
                console.warn("LVM > why was there a NOP?");
                this.pointer++;
                break

            case OpCode.BREAK: // break
                // implament breakpoints later
                console.warn("LVM > Hit breakpoint during execution: I", this.pointer);
                this.pointer++;
                break

            case OpCode.LOADNIL: // load a nil value into target register
                this.registers[instruction.A!] = {type: StackType.Nil, value: null};
                this.pointer++;
                break;

            case OpCode.LOADB: // load a boolean value into target register
                this.registers[instruction.A!] = {type: StackType.Bool, value: instruction.B! != 0};
                this.pointer++;
                break;

            case OpCode.LOADN: // load a number value into target register
                this.registers[instruction.A!] = {type: StackType.Number, value: instruction.D!};
                this.pointer++;
                break;

            case OpCode.LOADK: // load a constant from the baseProto into target register
                let c: StackValue = this.baseProto.Constants[instruction.D!];
                console.log("Loading constant: ", c);
                this.registers[instruction.A!] = {type: c.type, value: c.value};
                this.pointer++;
                break;

            case OpCode.MOVE: // copy the value of one register to another
                let v = this.registers[instruction.B!];
                Object.assign(this.registers[instruction.A!], v);
                this.pointer++;
                break;

            case OpCode.GETGLOBAL: // use the AUX as a key in the constant table to get a global value
                let getConstIndex = instruction.Aux?.readUint32LE(0);

                let globalGetKey = this.baseProto.Constants[getConstIndex!];
                if (globalGetKey.type != StackType.String) throw new Error("LVM > Global key is not a string");

                let globalValue = this.parentProgram.GlobalEnv.get(globalGetKey.value as string);
                if (globalValue == undefined) throw new Error("LVM > Global value not found");

                // this can be anything from the global environment
                this.registers[instruction.A!] = {type: globalValue.type, value: globalValue.value};
                this.pointer++;
                break;

            case OpCode.SETGLOBAL: 
                let setConstIndex = instruction.Aux?.readUint32LE(0);

                let globalSetkey = this.baseProto.Constants[setConstIndex!];
                if (globalSetkey == undefined) throw new Error("LVM > Global key is not a string");

                this.parentProgram.GlobalEnv.set(globalSetkey.value as string, this.registers[instruction.A!]);
                this.pointer++;
                break;
            
            case OpCode.GETUPVAL:
                let UVGet = this.upValues.get(instruction.B!);
                if (UVGet == undefined) throw new Error("LVM > Upvalue not found");
                if (UVGet.isRef)
                {
                    let RUVGet = UVGet as UpValueRef;
                    this.registers[instruction.A!] = RUVGet.store[RUVGet.index];
                } else {
                    let AUVGet = UVGet as UpValueAbs;
                    this.registers[instruction.A!] = AUVGet.value;
                }
                this.pointer++;
                break;

            case OpCode.SETUPVAL:
                let UVStore = this.upValues.get(instruction.B!);
                if (UVStore == undefined) throw new Error("LVM > Upvalue not found");
                if (UVStore.isRef)
                {
                    let RUVStore = UVStore as UpValueRef;
                    RUVStore.store[RUVStore.index] = this.registers[instruction.A!];
                } else {
                    let AUVStore = UVStore as UpValueAbs;
                    AUVStore.value = this.registers[instruction.A!];
                }
                this.pointer++;
                break;

            case OpCode.CLOSEUPVALS: // for each of the upvalues that are refrences to another stack, close them and make them absolute
                this.myUpValues.forEach((value, key) => {
                    if (key >= instruction.A!){
                        if (value.isRef)
                        {
                            let openUpValue = value as UpValueRef;
                            let closedUpValue = value as UpValueAbs;
                            closedUpValue.isRef = false;
                            closedUpValue.value = openUpValue.store[openUpValue.index];
                            this.myUpValues.delete(key); // the upvalue no longer activly refrences this stack
                        }
                    }
                })
                this.pointer++;
                break;

            case OpCode.GETIMPORT:

                // AUX: 3 10-bit indices of constant strings that, combined, constitute an import path; length of the path is set by the top 2 bits (1,2,3)
                let aux = instruction.Aux!.readUint32LE(0);
                let pathLength: number = parseInt(aux.toString()[0]) // this is not the best way to do this, but because not sucks this works for now
                
                let indices = [aux & 0x3FF, (aux >> 10) & 0x3FF, (aux >> 20) & 0x3FF];
                //console.log(this.baseProto.Constants)
                let currentImport: ImportTable | Closure = this.parentProgram.Imports;
                for (let i = 0; i < pathLength; i++)
                {
                    let key = this.baseProto.Constants[indices[i]];
                    if (key.type != StackType.String) throw new Error("LVM > Import key is not a string");
                    // check if 
                    if (currentImport instanceof NodeClosure || currentImport instanceof LuaClosure){
                        console.error("LVM > Import path is not a table");
                        break;
                    }
                    let iTable: ImportTable = currentImport as ImportTable;
                    if (iTable[key.value as string] == undefined) throw new Error("LVM > Import path not found");
                    currentImport = iTable[key.value as string];
                }

                this.registers[instruction.A!] = {type: StackType.Closure, value: currentImport as Closure};

                this.pointer++;
                break;

            default:
                if (instruction.OpCode < OpCode._COUNT) {
                    console.warn("LVM > Opcode not implemented: " + OpCodeNames[instruction.OpCode]);
                    this.pointer++; // probably shouldnt continue
                } else
                    console.error("Invalid opcode: " + instruction.OpCode);
                break;
        }

    }

    // implement later
    async Call(...args: StackValue[]): Promise<StackValue[]>
    {
        return args;
    }

}

export function DeserializeLuau(source: Buffer)
{
    const reader = new BinaryReader(source);
    const lProgram = {} as Program;

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
    lProgram.Protos = Protos;

    lProgram.MainProto = reader.readVarInt() as number;
    console.log("Main proto index: " + lProgram.MainProto);

    lProgram.GlobalEnv = new Map<string, StackValue>();
    
    lProgram.Imports = {
        print: nodePrint
    }

    let WrapedProto = new LuaClosure(lProgram, lProgram.MainProto, new Map<number, UpValue>());
    WrapedProto.runInstruction();
    WrapedProto.runInstruction();
    WrapedProto.runInstruction();

}