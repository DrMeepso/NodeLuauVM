function run(f, ...)
    f(...)
end

print("Hello world, this is lua!")
print(_VERSION)
run(print, "Hello world, this is lua!", true)