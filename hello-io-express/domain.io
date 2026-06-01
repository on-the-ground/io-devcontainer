// Hello World domain logic
//
// Io is the brains. JS (Express) is the platform.
// JS calls Lobby hello -> Io returns the greeting string.
// Bidirectional bridge proof: Io also calls back into JS (console.log).

Lobby hello := method(
    "Hello, World!"
)

99Bottles := Object clone do (
    _maxBottles := 99

    _numBottles := method(_num,
        (_num == 0) ifTrue(return "No more bottles of beer")
        (_num == 1) ifTrue(return "1 bottle of beer")
        return "#{_num} bottles of beer" interpolate
    )

    _action := method(_num,
        (_num > 1) ifTrue(return "Take one down and pass it around")
        (_num == 1) ifTrue(return "Take it down and pass it around")
        return "Go to the store and buy some more"
    )

    _step := method(_num,
        (_num > 0) ifTrue(return _num - 1) ifFalse(return _maxBottles)
    )

    _iterLyric := method(cur,
        "#{_numBottles(cur)} on the wall, #{_numBottles(cur)}" interpolate println
        next := _step(cur)
        "#{_action(cur)}, #{_numBottles(next)} on the wall" interpolate println
        (next == _maxBottles) ifTrue(return) 
        _iterLyric(next)
    )

    lyrics := method(
        _iterLyric(_maxBottles)
    )

)


Lobby 99bottles := method(99Bottles lyrics)