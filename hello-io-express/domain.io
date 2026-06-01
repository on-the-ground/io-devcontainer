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
    _nth := _maxBottles

    _headLyric := method(
        (_nth > 1) ifTrue(return "#{_nth} bottles of beer on the wall, #{_nth} bottles of beer. Take one down and pass it around," interpolate)
        (_nth == 1) ifTrue(return "#{_nth} bottle of beer on the wall, #{_nth} bottle of beer. Take it down and pass it around," interpolate)
        "No more bottles of beer on the wall, no more bottles of beer. Go to the store and buy some more,"
    )

    _step := method(
        (_nth > 0) ifTrue(_nth = _nth - 1) ifFalse(_nth = _maxBottles)
    )

    _tailLyric := method(
        (_nth > 1) ifTrue(return " #{_nth} bottles of beer on the wall." interpolate)
        (_nth == 1) ifTrue(return " #{_nth} bottle of beer on the wall." interpolate)
        " no more bottles of beer on the wall."
    )

    lyrics := method(
        loop(
            _headLyric println
            _step
            _tailLyric println
            (_nth == _maxBottles) ifTrue(break)
        )
    )
)

Lobby 99bottles := method(99Bottles clone lyrics)