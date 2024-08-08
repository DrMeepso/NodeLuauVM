import { Closure, ClosureType, ImportTable, LuaTable, LuaType, Program, Proto, StackType, StackValue, StackValueFromValue, UpValue, UpValueAbs, UpValueRef } from "./luauVM";
import { OpCode, OpCodeNames } from "./OpCodes";
import { Instruction } from "./readWord";

function IsVType(value: LuaType, type: StackType): boolean
{
    return value == type;
}
function IsSVType(value: StackValue, type: StackType): boolean
{
    return value.type == type;
}

// a closure containing lua bytecode
export class LuaClosure implements Closure {

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
            case OpCode.PREPVARARGS: // each closure has it's own stack so this is unused!
            case OpCode.NOP: // no operation
                //console.warn("LVM > why was there a NOP?");
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
                let importConsts: string[] = [ this.baseProto.Constants[indices[0]].value as string, this.baseProto.Constants[indices[1]].value as string, this.baseProto.Constants[indices[2]].value as string ];

                if (pathLength == 1) {
                    imported = currentTable[importConsts[0]] as Closure;
                } else if (pathLength == 2) {
                    let subTable: ImportTable = currentTable[importConsts[0]] as ImportTable;
                    imported = subTable[importConsts[1]] as Closure;
                } else if (pathLength == 3) {
                    let subTable: ImportTable = currentTable[importConsts[0]] as ImportTable;
                    let subSubTable: ImportTable = subTable[importConsts[1]] as ImportTable;
                    imported = subSubTable[importConsts[2]] as Closure;
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
                if (NCtable.type == StackType.Table) throw new Error("LVM > Attempt to call a non-table");

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
                
                //console.log("Calling closure: ", (callClosure.value! as Closure).Call!, " with ", callAgumentCount, " arguments");
                //console.log("Call arguments: ", callArugments);
                let resp = await (callClosure.value as Closure).Call(...callArugments);

                let returnNumber = resp.length;
                if (instruction.C! != 0 )
                {
                    returnNumber = instruction.C! - 1;
                } else {
                    //console.log("MULTRET")
                    this.topOfStack = instruction.A! + returnNumber - 1;
                }

                for (let i = 0; i < returnNumber; i++)
                {
                    //console.log("Setting register: ", instruction.A! + i, " to ", resp[i]);
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

            // logic operators against constants
            case OpCode.ANDK:
                this.registers[instruction.A!] = StackValueFromValue((this.registers[instruction.B!].value as boolean) && (this.baseProto.Constants[instruction.C!].value as boolean));
                this.pointer++;
                break;

            case OpCode.ORK:
                this.registers[instruction.A!] = StackValueFromValue((this.registers[instruction.B!].value as boolean) || (this.baseProto.Constants[instruction.C!].value as boolean));
                this.pointer++;
                break;

            case OpCode.CONCAT: // concatenate all strings in registers betwwen B and C and store in A
                let concatString = "";
                for (let i = instruction.B!; i <= instruction.C!; i++)
                {
                    concatString += this.registers[i].value as string;
                }
                this.registers[instruction.A!] = StackValueFromValue(concatString);
                this.pointer++;
                break;

            case OpCode.NOT: // logical not
                this.registers[instruction.A!] = StackValueFromValue(!(this.registers[instruction.B!].value as boolean));
                this.pointer++;
                break;

            case OpCode.MINUS: // a = -b
                this.registers[instruction.A!] = StackValueFromValue(-(this.registers[instruction.B!].value as number));
                this.pointer++;
                break;

            case OpCode.LENGTH: // get the length of a string or table, this as of right now; dosent work with metatables :(
                let lengthValue = this.registers[instruction.B!];
                if (lengthValue.type == StackType.String)
                    this.registers[instruction.A!] = StackValueFromValue((lengthValue.value as string).length);
                else if (lengthValue.type == StackType.Table)
                    this.registers[instruction.A!] = StackValueFromValue((lengthValue.value as LuaTable).size);
                else
                    this.throwError("LVM > Attempt to get length of non-string or table");
                this.pointer++;
                break;

            case OpCode.NEWTABLE: // create a new table
                this.registers[instruction.A!] = {type: StackType.Table, value: new Map<LuaType, StackValue>()};
                this.pointer++;
                break;

            case OpCode.DUPTABLE: //duplicate a table from the proto constant table
                let dupTable = this.baseProto.Constants[instruction.D!];
                if (dupTable.type != StackType.Table) this.throwError("LVM > Attempt to duplicate non-table");
                let DupedTable: LuaTable = new Map<LuaType, StackValue>();
                for (let [key, value] of (dupTable.value as LuaTable).entries())
                {
                    let ck: number = value.value as number;
                    DupedTable.set(this.baseProto.Constants[ck].value, StackValueFromValue(null));
                }
                this.registers[instruction.A!] = {type: StackType.Table, value: DupedTable};
                this.pointer++;
                break;

            case OpCode.SETLIST: // loop though registures and set them in a table
                let setListTable = this.registers[instruction.A!];
                if (setListTable.type != StackType.Table) this.throwError("LVM > Attempt to set list in non-table");

                let setListStart = instruction.B!; // the first register to start at
                let setListCount = instruction.C! - 1; // the amount of registers to loop through

                if (setListCount == 0)
                {
                    setListCount = this.topOfStack - setListStart + 1;
                }

                let tableIndexStart = instruction.Aux!.readUint32LE(0);

                for (let i = 0; i < setListCount; i++)
                {
                    (setListTable.value as LuaTable).set(tableIndexStart + i, this.registers[setListStart + i]);
                }

                this.pointer++;
                break;

            case OpCode.FORNPREP: // setup registers for a numeric for loop!
                let Limmit = this.registers[instruction.A!].value as number;
                let Step = this.registers[instruction.A! + 1].value as number;
                let Index = this.registers[instruction.A! + 2].value as number;

                // jump to the next instruction if the loop shouldnt run
                this.pointer += (Step > 0 ? Index <= Limmit : Limmit <= Index) ? 1 : instruction.D!;
                break;

            case OpCode.FORNLOOP: // run the numeric for loop!
                let NLLimmit = this.registers[instruction.A!].value as number;
                let NLStep = this.registers[instruction.A! + 1].value as number;
                let NLIndex = this.registers[instruction.A! + 2].value as number;
                this.registers[instruction.A! + 2] = StackValueFromValue(NLIndex + NLStep);

                if (NLStep > 0 ? NLIndex <= NLLimmit : NLLimmit <= NLIndex)
                    this.pointer += instruction.D!;
                else
                    this.pointer++;
                
                break;
            
            // tbh i dont know what these do, they seem to have some deeper meaning
            // in the official VM, but from what i can see they can just jump to the
            // FORGLOOP instruction and it works fine, so...
            case OpCode.FORGPREP_INEXT:
            case OpCode.FORGPREP_NEXT:
            case OpCode.FORGPREP:
                this.pointer += instruction.D! + 1;
                //console.log(instruction.D!)
                break;

            case OpCode.FORGLOOP: // run a generic for loop!

                this.topOfStack = instruction.A! + 6; // i dont know where 6 comes from, but it works

                let Generator = this.registers[instruction.A!].value as Closure;
                let State = this.registers[instruction.A! + 1]
                let FGIndex = this.registers[instruction.A! + 2]

                if (!Generator)
                    throw new Error("LVM > Attempt to run a nil generator");

                let vals = await Generator.Call(State, FGIndex);
                let loopVariableCount = (24 >>> instruction.Aux!.readUint32LE(0)) & 0xFF;
                for (let i = 0; i < loopVariableCount; i++)
                {
                    this.registers[instruction.A! + 3 + i] = vals[i];
                }

                if (this.registers[instruction.A! + 3].value != null) {
                    this.registers[instruction.A! + 2] = this.registers[instruction.A! + 3];
                    this.pointer += instruction.D! + 1;
                } else
                    this.pointer += 1;

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
                //console.log("LVM > Running instruction:" + this.pointer, OpCodeNames[this.code[this.pointer].OpCode]);
                //console.log("Program Line:", this.baseProto.InstructionInfo[this.pointer]);
                await this.runInstruction();

                //console.log(this.registers[1])

            }
            resolve(this.returnValues);
        });
    }

}