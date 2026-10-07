# Controller Registry

**Responsibility:** Single discovery surface for controller implementations.

| API | Behavior |
|---|---|
| `register()` | Add one implementation per controller id; throws on duplicate |
| `get()` / `tryGet()` / `has()` / `list()` | Standard lookup (`IControllerRegistry`) |
| `setManifest()` | Bind game manifest for enablement checks |
| `isEnabled()` / `listEnabled()` / `getEnabled()` | Respect `controllers[].enabled` from manifest |

Controllers execute actions. The registry does not implement game logic.
