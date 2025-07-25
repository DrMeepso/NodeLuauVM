# LuauVM in Typescript

Based on the [Luau Repo's VM](https://github.com/luau-lang/luau) and [Fiu](https://github.com/rce-incorporated/Fiu)

> "Any application that can be written in JavaScript, will eventually be written in JavaScript." - Atwood's law

--- 
## Progress

### OpCodes Implemented: 84/84 ✅

All Luau VM opcodes are now implemented, including:
- LOADKX - Load constant using extended index
- JUMPX - Extended jump instruction
- COVERAGE - Code coverage tracking (no-op)
- CAPTURE - Capture upvalue for closures
- SUBRK/DIVRK - Reverse arithmetic operations with constants
- JUMPXEQK* - Extended conditional jumps with constants
- IDIV/IDIVK - Integer division operations

### APIs Implemented: 0
- [ ] `os`
- [ ] `string`
- [ ] `table`
- [ ] `math`
- [ ] `bit32`
- [ ] `coroutine`
- [ ] `debug`
- [ ] `utf8`

### Metatable support: No, maybe in the future
Why? because I started writing the VM thinking metatables were solved for in the the compiler, I don't know why I thought that, but I was very wrong!