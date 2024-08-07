import { assert, count } from "console";
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
type LuaType = string | number | boolean | null | LuaTable | Closure;

type LuaTable = Map<LuaType, StackValue>;

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

function StackValueFromValue(value: any) 
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
        console.log("LVM:OUT >", ...this.LuaArgsToNodeArgs(args))
        return [];
    }
}

// wrap a nodejs native function in a closure class so lua can call it!
export function wrapNodeFunction(f: (...args: any[]) => any[]) {
    const newClosure = new NodeClosure();
    newClosure.Call = function(...args: StackValue[]): Promise<StackValue[]> {
        return new Promise((resolve, reject) => {
            const nodeArgs = newClosure.LuaArgsToNodeArgs(args);
            const nodeReturn = f(...nodeArgs);
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

    topOfStack = -1; // the top of the stack, used for vararg functions

    hasFinished: boolean = false;
    returnValues: StackValue[] = [];

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

    throwError(message: string)
    {
        // find the current line of the error
        let line = this.baseProto.InstructionInfo[this.pointer];
        throw new Error(`L:${line} | ${message}`);
    }

    async runInstruction()
    {
        if (this.pointer >= this.code.length)
        {
            console.error("Program counter is out of bounds");
            return;
        }
        let instruction = this.code[this.pointer];

        //console.log("Running instruction: ", OpCodeNames[instruction.OpCode]);
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
                this.registers[instruction.A!] = {type: c.type, value: c.value};
                this.pointer++;
                break;

            case OpCode.MOVE: // copy the value of one register to another
                let v = this.registers[instruction.B!];
                //Object.assign(this.registers[instruction.A!], v);
                this.registers[instruction.A!] = v
                this.pointer++;
                break;

            case OpCode.GETGLOBAL: // use the AUX as a key in the constant table to get a global value
                let getConstIndex = instruction.Aux?.readUint32LE(0);

                let globalGetKey = this.baseProto.Constants[getConstIndex!];
                if (globalGetKey.type != StackType.String) this.throwError("LVM > Global key is not a string");

                let globalValue = this.parentProgram.GlobalEnv.get(globalGetKey.value as string);
                if (globalValue == undefined)
                    globalValue = StackValueFromValue(null);

                // this can be anything from the global environment
                this.registers[instruction.A!] = {type: globalValue.type, value: globalValue.value};
                this.pointer++;
                break;

            case OpCode.SETGLOBAL: 
                let setConstIndex = instruction.Aux?.readUint32LE(0);

                let globalSetkey = this.baseProto.Constants[setConstIndex!];
                if (globalSetkey == undefined) this.throwError("LVM > Global key is not a string");

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
                let pathLength: number = (aux >>> 30)
                
                let indices = [(aux >> 20) & 0x3FF, (aux >> 10) & 0x3FF, aux & 0x3FF];
                //console.log(this.baseProto.Constants)
                let currentTable: ImportTable = this.parentProgram.Imports;
                let imported: Closure | undefined = undefined;
                let consts: string[] = [ this.baseProto.Constants[indices[0]].value as string, this.baseProto.Constants[indices[1]].value as string, this.baseProto.Constants[indices[2]].value as string ];

                if (pathLength == 1) {
                    imported = currentTable[consts[0]] as Closure;
                } else if (pathLength == 2) {
                    let subTable: ImportTable = currentTable[consts[0]] as ImportTable;
                    imported = subTable[consts[1]] as Closure;
                } else if (pathLength == 3) {
                    let subTable: ImportTable = currentTable[consts[0]] as ImportTable;
                    let subSubTable: ImportTable = subTable[consts[1]] as ImportTable;
                    imported = subSubTable[consts[2]] as Closure;
                }

                if (imported == undefined) throw new Error("LVM > Import path not found");

                //console.log("Imported: ", imported);

                this.registers[instruction.A!] = {type: StackType.Closure, value: imported as Closure};

                this.pointer++;
                break;

            case OpCode.GETTABLE:
                let fetchedTable = this.registers[instruction.B!];
                if (fetchedTable.type != StackType.Table) throw new Error("LVM > Value is not a table");
                let fetchedValue = (fetchedTable.value as LuaTable).get(this.registers[instruction.C!].value);
                if (fetchedValue == undefined) throw new Error("LVM > Value not found in table");
                this.registers[instruction.A!] = fetchedValue;

                this.pointer++;
                break;
            
            case OpCode.SETTABLE:
                let setTable = this.registers[instruction.A!];
                if (setTable.type != StackType.Table) throw new Error(`LVM > attempt to set ${this.registers[instruction.B!].value} on type of ${setTable.type}`);
                (setTable.value as LuaTable).set(this.registers[instruction.B!].value, this.registers[instruction.C!]);
                this.pointer++;
                break;

            case OpCode.GETTABLEKS: // fetch a value from a table using a constant key
                let GTKconstIndex = instruction.Aux!.readUint32LE(0);
                let GTKtable = this.registers[instruction.B!];
                if (GTKtable.type != StackType.Table) this.throwError("LVM > Attempt to get table value from non-table");
                
                let GTKkey = this.baseProto.Constants[GTKconstIndex];
                let GTKvalue: StackValue | undefined = (GTKtable.value as LuaTable).get(GTKkey.value);
                if (GTKvalue == undefined) throw new Error("LVM > Table key not found on constant table?");
                this.registers[instruction.A!] = GTKvalue;

                this.pointer++;
                break;

            case OpCode.SETTABLEKS: // set a value in a table using a constant key
                let STKconstIndex = instruction.Aux!.readUint32LE(0);
                let STKtable = this.registers[instruction.B!];
                if (STKtable.type != StackType.Table) this.throwError("LVM > Attempt to set table value from non-table");

                let STKkey = this.baseProto.Constants[STKconstIndex];
                (STKtable.value as LuaTable).set(STKkey.value, this.registers[instruction.A!]);

                this.pointer++;
                break;

            case OpCode.GETTABLEN: // get value from table using smallint as a key (C)
                let GTNTable = this.registers[instruction.B!];
                if (GTNTable.type != StackType.Table) this.throwError("LVM > Attempt to get table value from non-table");

                let GTNValue = (GTNTable.value as LuaTable).get(instruction.C!);
                if (GTNValue == undefined) // not our issue, lua will just return nil
                    GTNValue = StackValueFromValue(null);

                this.registers[instruction.A!] = GTNValue;

                this.pointer++;
                break;

            case OpCode.SETTABLEN: // set value in table using smallint as a key (C)
                let STNTable = this.registers[instruction.B!];
                if (STNTable.type != StackType.Table) this.throwError("LVM > Attempt to set table value from non-table");

                (STNTable.value as LuaTable).set(instruction.C!, this.registers[instruction.A!]);

                this.pointer++;
                break;

            case OpCode.NEWCLOSURE: // create a new closure from a lua proto!
                // because this closure should be able to use the upvalues of the parents parent, we pass all upvalues of this closure.
                let newClosure = new LuaClosure(this.parentProgram, instruction.D!, this.upValues);
                this.registers[instruction.A!] = {type: StackType.Closure, value: newClosure};
                this.pointer++;
                break;

            case OpCode.NAMECALL: // call a function by name?
                // NAMECALL: prepare to call specified method by name by loading function from source register using constant index into target register and copying source register into target register + 1
                // assuiming source register is a table, the constant will be the key to the table
                // then moving the function to the target register
                // then moving the table to the target register + 1 so this.register[T + 1] will contain the source table

                let NCtable = this.registers[instruction.B!];
                assert(NCtable.type == StackType.Table, "LVM > Attempt to call a non-table");

                let NCkey = this.baseProto.Constants[instruction.Aux!.readUint32LE(0)];
                let NCvalue = (NCtable.value as LuaTable).get(NCkey.value);
                if (NCvalue == undefined) throw new Error("LVM > Value not found in table");
                if (NCvalue.type != StackType.Closure) throw new Error("LVM > Attempt to namecall a non-function?");

                this.registers[instruction.A!] = NCvalue; // move the function to the target register
                this.registers[instruction.A! + 1] = NCtable; // move the table to the target register + 1

                if (this.code[this.pointer + 1].OpCode != OpCode.CALL)
                    throw new Error("LVM > NAMECALL must be followed by CALL, Bytecode is invalid!");

                this.pointer += 1;
                break;

            case OpCode.CALL: // run a closure from stack! YAY!!!!
                let callClosure = this.registers[instruction.A!];
                if (callClosure.type != StackType.Closure) throw new Error("LVM > Attempt to call a non-function, huh?");

                let callAgumentCount = instruction.B!; // the first argument is the function itself
                if (callAgumentCount == 0) // function is MULTRET
                {
                    callAgumentCount = this.topOfStack - instruction.A!;
                } else {
                    callAgumentCount = instruction.B! - 1;
                }

                let callArugments = this.registers.slice(instruction.A! + 1, instruction.A! + 1 + callAgumentCount);
                
                let resp = await (callClosure.value as Closure).Call(...callArugments);

                let returnNumber = resp.length;
                if (instruction.C! != 0 )
                {
                    returnNumber = instruction.C! - 1;
                } else {
                    this.topOfStack = instruction.A! + returnNumber - 1;
                }

                for (let i = 0; i < returnNumber; i++)
                {
                    if (resp[i] == undefined)
                        this.registers[instruction.A! + i] = {type: StackType.Nil, value: null};
                    else
                        this.registers[instruction.A! + i] = resp[i];
                }

                this.pointer++
                break;

            case OpCode.RETURN: // return a value from the closure!

                let ReturnIndexStart = instruction.A!;
                let ReturnCount = instruction.B! - 1;

                if (ReturnCount == -1)
                {
                    ReturnCount = this.topOfStack - ReturnIndexStart + 1;
                }

                this.returnValues = this.registers.slice(ReturnIndexStart, ReturnIndexStart + ReturnCount);
                this.hasFinished = true;

                break;

            case OpCode.JUMP: // jump to a location in the bytecode
            case OpCode.JUMPBACK: // used for interupts of while and for loops
                this.pointer += instruction.D!;
                break;

            case OpCode.JUMPIF: // jump if the source register is not nil or false
                if (this.registers[instruction.A!].value != null && this.registers[instruction.A!].value != false)
                {
                    this.pointer += instruction.D!;
                } else {
                    this.pointer++;
                }
                break;

            case OpCode.JUMPIFNOT: // jump if the source register is nil or false
                if (this.registers[instruction.A!].value == null || this.registers[instruction.A!].value == false)
                {
                    this.pointer += instruction.D!;
                } else {
                    this.pointer++;
                }
                break;

            // jump operators, jumping if the condition is met
            // A: source register 1
            // D: jump offset
            // AUX: source register 2
            case OpCode.JUMPIFEQ: // jump if the source registers are equal
                if (this.registers[instruction.A!].value == this.registers[instruction.Aux!.readUInt32LE(0)].value)
                    this.pointer += instruction.D!;
                 else
                    this.pointer++;
                break;

            case OpCode.JUMPIFLE: // jump if source register 1 is less than or equal to source register 2
                if ((this.registers[instruction.A!].value as number) <= (this.registers[instruction.Aux!.readUInt32LE(0)].value as number))
                    this.pointer += instruction.D!;
                else 
                    this.pointer++;
                break;

            case OpCode.JUMPIFLT: // jump if source register 1 is less than source register 2
                if ((this.registers[instruction.A!].value as number) < (this.registers[instruction.Aux!.readUInt32LE(0)].value as number))
                    this.pointer += instruction.D!;
                else
                    this.pointer++;
                break;

            case OpCode.JUMPIFNOTEQ: // jump if the source registers are not equal
                if (this.registers[instruction.A!].value != this.registers[instruction.Aux!.readUInt32LE(0)].value)
                    this.pointer += instruction.D!;
                else
                    this.pointer++;
                break;

            case OpCode.JUMPIFNOTLE: // jump if source register 1 is not less than or equal to source register 2
                if ((this.registers[instruction.A!].value as number) > (this.registers[instruction.Aux!.readUInt32LE(0)].value as number))
                    this.pointer += instruction.D!;
                else
                    this.pointer++;
                break;

            case OpCode.JUMPIFNOTLT: // jump if source register 1 is not less than source register 2
                if ((this.registers[instruction.A!].value as number) >= (this.registers[instruction.Aux!.readUInt32LE(0)].value as number))
                    this.pointer += instruction.D!;
                else
                    this.pointer++;
                break;

            // basic math operators
            case OpCode.ADD: // add two values together
                this.registers[instruction.A!] = StackValueFromValue((this.registers[instruction.B!].value as number) + (this.registers[instruction.C!].value as number));
                this.pointer++;
                break;

            case OpCode.SUB: // subtract two values
                this.registers[instruction.A!] = StackValueFromValue((this.registers[instruction.B!].value as number) - (this.registers[instruction.C!].value as number));
                this.pointer++;
                break;

            case OpCode.MUL: // multiply two values
                this.registers[instruction.A!] = StackValueFromValue((this.registers[instruction.B!].value as number) * (this.registers[instruction.C!].value as number));
                this.pointer++;
                break;

            case OpCode.DIV: // divide two values
                this.registers[instruction.A!] = StackValueFromValue((this.registers[instruction.B!].value as number) / (this.registers[instruction.C!].value as number));
                this.pointer++;
                break;

            case OpCode.MOD: // modulo two values
                this.registers[instruction.A!] = StackValueFromValue((this.registers[instruction.B!].value as number) % (this.registers[instruction.C!].value as number));
                this.pointer++;
                break;

            case OpCode.POW: // power of two values
                this.registers[instruction.A!] = StackValueFromValue(Math.pow((this.registers[instruction.B!].value as number), (this.registers[instruction.C!].value as number)));
                this.pointer++;
                break;

            // math operators agasnt values from the constant table
            case OpCode.ADDK:
                this.registers[instruction.A!] = StackValueFromValue((this.registers[instruction.B!].value as number) + (this.baseProto.Constants[instruction.C!].value as number));
                this.pointer++;
                break;

            case OpCode.SUBK:
                this.registers[instruction.A!] = StackValueFromValue((this.registers[instruction.B!].value as number) - (this.baseProto.Constants[instruction.C!].value as number));
                this.pointer++;
                break;

            case OpCode.MULK:
                this.registers[instruction.A!] = StackValueFromValue((this.registers[instruction.B!].value as number) * (this.baseProto.Constants[instruction.C!].value as number));
                this.pointer++;
                break;

            case OpCode.DIVK: 
                this.registers[instruction.A!] = StackValueFromValue((this.registers[instruction.B!].value as number) / (this.baseProto.Constants[instruction.C!].value as number));
                this.pointer++;
                break;

            case OpCode.MODK:
                this.registers[instruction.A!] = StackValueFromValue((this.registers[instruction.B!].value as number) % (this.baseProto.Constants[instruction.C!].value as number));
                this.pointer++;
                break;

            case OpCode.POWK:
                this.registers[instruction.A!] = StackValueFromValue(Math.pow((this.registers[instruction.B!].value as number), (this.baseProto.Constants[instruction.C!].value as number)));
                this.pointer++;
                break;
            
            // Logic operators
            case OpCode.AND: // logical and
                this.registers[instruction.A!] = StackValueFromValue((this.registers[instruction.B!].value as boolean) && (this.registers[instruction.C!].value as boolean));
                this.pointer++;
                break;

            case OpCode.OR: // logical or
                this.registers[instruction.A!] = StackValueFromValue((this.registers[instruction.B!].value as boolean) || (this.registers[instruction.C!].value as boolean));
                this.pointer++;
                break;


            default:
                if (instruction.OpCode < OpCode._COUNT) {
                    console.error("LVM > Opcode not implemented: " + OpCodeNames[instruction.OpCode]);
                    this.pointer++; // probably shouldnt continue
                } else
                    console.error("Invalid opcode: " + instruction.OpCode);
                break;
        }

    }

    async Call(...args: StackValue[]): Promise<StackValue[]>
    {
        return new Promise(async (resolve, reject) => {
            this.registers = args;
            this.topOfStack = args.length - 1;
            this.hasFinished = false;
            this.returnValues = [];
            while (!this.hasFinished)
            {
                console.log("LVM > Running instruction:" + this.pointer);
                console.log("Program Line:", this.baseProto.InstructionInfo[this.pointer]);
                await this.runInstruction();
            }
            resolve(this.returnValues);
        });
    }

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
        print: nodePrint,
        math: {
            add: wrapNodeFunction((a: number, b: number) => { return [a + b, false] })
        }
    }

    let WrapedProto = new LuaClosure(lProgram, lProgram.MainProto, new Map<number, UpValue>());
    
    console.log(WrapedProto.baseProto.Constants);

    let values = await WrapedProto.Call();
    console.log("Return values: ", values);

}