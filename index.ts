import { spawn } from "child_process";
import { DeserializeLuau } from "./luauVM";

function GenByteCode(fileName: string): Promise<Buffer> // byte code
{
    return new Promise((resolve, reject) => {

        let luauCompiler = spawn("luau-compile", ["--binary", fileName]); // get the textual representation of the bytecode from the luau compiler
        let byteCode = Buffer.from("");

        luauCompiler.stdout.on("data", (data) => {
            byteCode = Buffer.concat([byteCode, data]);
        });

        luauCompiler.stderr.on("data", (data) => {
            console.error(data.toString());
        });

        luauCompiler.on("close", (code) => {
            console.log(`child process exited with code ${code}`);
            resolve(byteCode);
        });

    })
}

async function main()
{
    let byteCode = await GenByteCode("test.lua");
    DeserializeLuau(byteCode);
}
main();