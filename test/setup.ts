// Silence the plugin's default logger during tests unless a test opts in.
// The default `log` reads OPENCODE_KC_LOG on every call, so a test that wants to
// assert log output uses `vi.stubEnv("OPENCODE_KC_LOG", "warn")` (auto-restored
// by `unstubEnvs`) together with a console spy.
process.env.OPENCODE_KC_LOG = "silent";
