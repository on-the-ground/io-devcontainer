// Hello World domain logic
//
// Io is the brains. JS (Express) is the platform.
// JS calls Lobby hello -> Io returns the greeting string.
// Bidirectional bridge proof: Io also calls back into JS (console.log).

Lobby hello := method(
    "Hello, World!"
)
