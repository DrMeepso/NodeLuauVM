# LuauVM in Typescript

Based on the [Luau Repo's VM](https://github.com/luau-lang/luau) and [Fiu](https://github.com/rce-incorporated/Fiu)

> "Any application that can be written in JavaScript, will eventually be written in JavaScript." - Atwood's law

--- 
## Progress

### OpCodes Implemented: 64/84

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