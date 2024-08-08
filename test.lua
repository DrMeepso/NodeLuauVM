--[[
print("Hello world, this is lua!")
wait(100)
print(math.add(1,2) + 10)
--]]

local tmp = {10,20,30,40,50}

--[[
local generator, state, index = ipairs(tmp)
--print(generator, state, index)
print(generator(state, 0))
]]

for k,v in ipairs(tmp) do
    print(k,v)
end

local tmp2 = {a=10,b=20,c=30,d=40,e=50}
for k,v in pairs(tmp2) do
    print(k,v)
end

print("Hello world, this is lua!")