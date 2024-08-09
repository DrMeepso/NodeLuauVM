import { assert } from "console";
import { BinaryReader } from "./binaryReader";
import { LuaClosure } from "./luauClosure";
import { HasAux, ReadOpCode, type Instruction } from "./readWord";

export interface Proto {

    MaxStackSize: number;
    NumParams: number;
    NumUpvalues: number; // number of upvalues, not including the upvalue of the function itself
    IsVararg: number; // 0 = fixed number of arguments, 1 = vararg function
    LineDefined: number; // first line of the function definition
    DebugName: string; // name of the function

    NumInstructions: number;
    Instructions: Array<Instruction>;

    NumConstants: number;
    Constants: Array<StackValue>;

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
export type LuaType = string | number | boolean | null | LuaTable | Closure;

export type LuaTable = Map<LuaType, StackValue>;

export enum StackType {
    Nil = 0,
    Bool = 1,
    Number = 2,
    String = 3,
    Table = 4,
    Closure = 5,
    Vector = 6,
    Import = 7 // still dont know what this dose
}

export interface StackValue {
    type: StackType;
    value: LuaType;
}

export type ImportTable = { [key: string]: LuaType | ImportTable };

export interface Program {
    Protos: Array<Proto>;
    MainProto: number;
    GlobalEnv: Map<string, StackValue>; // global environment of the program, getenv and setenv
    Imports: ImportTable;
}

export interface UpValue {
    isRef: boolean;
}
export interface UpValueRef extends UpValue {
    isRef: true; // the value is stored in another stack!
    index: number;
    store: StackValue[]; // the stack the index is from
}
export interface UpValueAbs extends UpValue {
    isRef: false; // the value is stored in the upvalue
    value: StackValue;
}

export function StackValueFromValue(value: any) 
{
    if (value == null) return {type: StackType.Nil, value: null};
    if (typeof value == "boolean") return {type: StackType.Bool, value: value};
    if (typeof value == "number") return {type: StackType.Number, value: value};
    if (typeof value == "string") return {type: StackType.String, value: value};
    if (value instanceof Map) return {type: StackType.Table, value: value};
    if (value instanceof LuaClosure || value instanceof NodeClosure) return {type: StackType.Closure, value: value};
    console.warn(`LVM > Unable to determine type of value: ${value}`);
    return {type: StackType.Nil, value: null}; // we dont know what it is :/
}

export function ReadProto(reader: BinaryReader, ByteCodeID: number, StringArray: Array<string>)
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
        if (hasAUX) // write another noop instruction
            Instructions.push({A: 0, B: 0, C: 0, D: 0, E: 0, Aux: Buffer.alloc(0), OpCode: 0});
            
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
            case 4: // import, same as aux for getimport instruction. could be replaced with nil or path
                let world = reader.readWord();
                addConstant(StackType.Import, world);
                break;
            case 5: // table
                let tableSize = reader.readVarInt();
                let table: LuaTable = new Map();
                for (let i = 0; i < tableSize; i++)
                {
                    table.set(table.size, StackValueFromValue(reader.readVarInt()));
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
    let InstructionInfo: number[] = []; // the line number of each instruction, based on instruction index
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

export function luaTypeFromNodeValue(value: any): StackValue {
    if (value == null) return {type: StackType.Nil, value: null};
    if (typeof value == "boolean") return {type: StackType.Bool, value: value};
    if (typeof value == "number") return {type: StackType.Number, value: value};
    if (typeof value == "string") return {type: StackType.String, value: value};
    if (value instanceof Map) return {type: StackType.Table, value: value};
    if (value.type == ClosureType.LUA || value.type == ClosureType.NODE) return {type: StackType.Closure, value: value};

    return {type: StackType.Nil, value: null}; // we dont know what it is :/
}

// implement later
export function WrapClosure(lclosure: LuaClosure): (...args: any[]) => Promise<any[]> {
    return async function(...args: any[]) {
        let luaArgs = args.map((arg) => { return luaTypeFromNodeValue(arg) });
        let luaResp = await lclosure.Call(...luaArgs);
        return luaResp.map((arg) => { return arg.value });
    }
}

export enum ClosureType {
    NODE = "NODE",
    LUA = "LUA"
}
export interface Closure {
    type: ClosureType;
    Call(...args: StackValue[]): Promise<StackValue[]>;
}

class NodeClosure implements Closure {
    type = ClosureType.NODE;
    async Call(...args: StackValue[]): Promise<StackValue[]> {
        return args;
    }
    LuaArgsToNodeArgs(args: StackValue[]): any[] {
        if (args == null) return [];
        return args.map((arg) => { return arg ? arg.value : null });
    }
    NodeArgsToLuaArgs(args: any[]): StackValue[] {
        if (args == null) return [];
        return args.map((arg) => { return luaTypeFromNodeValue(arg) });
    }
}

// the print function for lua, not warped because i want the "LVM:OUT >" prefix :)
let nodePrint = new class Print extends NodeClosure {
    type = ClosureType.NODE;
    async Call(...args: StackValue[]): Promise<StackValue[]> {
        console.log("LVM:OUT >", ...this.LuaArgsToNodeArgs(args))
        return [];
    }
}

// wrap a nodejs native function in a closure class so lua can call it!
export function wrapNodeFunction(f: (...args: any[]) => any) {
    const newClosure = new NodeClosure();
    newClosure.Call = function(...args: StackValue[]): Promise<StackValue[]> {
        return new Promise(async (resolve, reject) => {
            const nodeArgs = newClosure.LuaArgsToNodeArgs(args);
            const nodeReturn = await f(...nodeArgs);
            resolve(newClosure.NodeArgsToLuaArgs(nodeReturn));
        });
    }
    return newClosure;
}

export async function DeserializeLuau(source: Buffer)
{
    const reader = new BinaryReader(source);
    const lProgram = {} as Program;

    let luauVersion = reader.readByte();
    let typesVersion = 0; // only used after luau version 4
    if (luauVersion >= 4)
    {
        typesVersion = reader.readByte();
        //console.log("Types version: " + typesVersion);
    } else {
        console.error("Unsupported Luau version: " + luauVersion + ", please use version 4 or higher");
    }
    //console.log("Luau version: " + luauVersion);

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
    //console.log("Proto count: " + protoCount);
    let Protos: Array<Proto> = [];
    for (let i = 0; i < protoCount; i++)
    {
        Protos.push(ReadProto(reader, i, stringTable));
        //console.log("Proto:", Protos[i].DebugName || "(??)");
    }
    lProgram.Protos = Protos;

    lProgram.MainProto = reader.readVarInt() as number;
    //console.log("Main proto index: " + lProgram.MainProto);

    lProgram.GlobalEnv = new Map<string, StackValue>();
    
    function IPairs(table: LuaTable): LuaType[] {
        const generator = wrapNodeFunction(function(tableg: LuaTable, index: number) {
            const val = tableg.get(index + 1)?.value
            return [val ? index + 1 : null, val];
        });
        return [generator, table, 0];
    }

    function Pairs(table: LuaTable): LuaType[]
    {
        const MapKeys: LuaType[] = []
        table.forEach((value, key) => {
            MapKeys.push(key);
        });
        const generator = wrapNodeFunction(function(tableg: LuaTable, index: LuaType) {
            const nextIndex = MapKeys[MapKeys.indexOf(index) + 1]
            if (nextIndex == null) return [null, null];
            const val = tableg.get(nextIndex)?.value;
            return [nextIndex, val];
        });
        return [generator, table, null];
    }

    lProgram.Imports = {
        print: nodePrint,
        wait: wrapNodeFunction((time: number) => { return new Promise((resolve) => { setTimeout(resolve, time) }) }),
        ipairs: wrapNodeFunction(IPairs),
        pairs: wrapNodeFunction(Pairs),
        assert: wrapNodeFunction(assert),
        _VERSION: "Luau 6, JSRuntime",
    }

    let WrapedProto = new LuaClosure(lProgram, lProgram.MainProto, new Map<number, UpValue>());
    //console.log("Constants:", WrapedProto.baseProto.Constants);
    let WrapedMain = WrapClosure(WrapedProto);

    let values = await WrapedMain();
    //console.log("Return values: ", values);

}