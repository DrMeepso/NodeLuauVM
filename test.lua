function test(f, ...)
    f(...)
end

print("Hello world, this is lua!")
print(_VERSION)
test(print, "Hello world, this is lua!", true)