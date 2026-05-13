// test-future.io -- Lobby test methods called by name from test-future.mjs
//
// Each method returns its result as the last expression.
// println output is cleared by do_resume_eval; only "==> value" survives.
//
// try/catch pattern:
//   e := try(code)
//   e catch(ExcType, Lobby __slot := ...)
//   __slot

// 1. Pure Io FutureProxy
Lobby test_pureFutureProxy := method(
    obj := Object clone
    obj double := method(v, v * 2)
    f := obj @double(21)
    f println
)

// 2. JS Promise.resolve(string) -> IoFuture await
Lobby test_promiseResolveString := method(
    result := JS get("Promise") resolve("hello from promise")
    result await println
)

// 3. JS Promise.resolve(list) -> await -> size
Lobby test_promiseResolveListSize := method(
    result := JS get("Promise") resolve(list(10, 20, 30))
    result await size println
)

// 4. [core] domain @handler -> JS Promise.resolve -> result propagation
Lobby test_actorJsPromiseChain := method(
    HandlerActor := Object clone do(
        fetch := method(msg,
            jsfunction("return Promise.resolve('handled: ' + arguments[0])") call(msg)
        )
    )
    result := HandlerActor @fetch("hello")
    result await println
)

// 5. [core] delayed Promise (setTimeout 10ms) -> actor chain
Lobby test_delayedPromise := method(
    SlowActor := Object clone do(
        compute := method(v,
            jsfunction("return new Promise(r => setTimeout(() => r(arguments[0] * 2), 10))") call(v)
        )
    )
    result := SlowActor @compute(21)
    result await println
)

// 6. JS Promise.reject -> try/catch -> extract e.error
Lobby test_promiseReject := method(
    Lobby __t6 := nil
    result := JS get("Promise") reject("async boom")
    e := try(result await)
    e catch(Exception,
        Lobby __t6 := "caught: " .. e error
    )
    __t6
)

// 7. [core] actor @ + JS Promise.reject -> actor handles internally -> error marker propagation
// FutureProxy does not auto-propagate actor exceptions to caller try/catch.
// Actor must catch internally and return domain value (hexagonal adapter pattern).
Lobby test_actorReject := method(
    FailActor := Object clone do(
        run := method(
            Lobby __t7 := nil
            e := try(
                jsfunction("return Promise.reject(new Error('actor failed'))") call await
            )
            e catch(Exception,
                Lobby __t7 := "ERR:" .. e error
            )
            __t7
        )
    )
    f := FailActor @run
    f println
)
