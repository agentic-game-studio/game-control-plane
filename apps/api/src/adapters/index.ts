import { registerEngineAdapter } from "../services/engine-adapter-factory.js";
import { GodotEngineAdapter } from "./godot-adapter.js";
import { PhaserEngineAdapter } from "./phaser-adapter.js";
import { Web3DEngineAdapter } from "./web3d-adapter.js";
import { UnityEngineAdapter } from "./unity-adapter.js";
import { UnrealEngineAdapter } from "./unreal-adapter.js";

registerEngineAdapter(new GodotEngineAdapter());
registerEngineAdapter(new PhaserEngineAdapter());
registerEngineAdapter(new Web3DEngineAdapter("threejs"));
registerEngineAdapter(new Web3DEngineAdapter("babylon"));
registerEngineAdapter(new UnityEngineAdapter());
registerEngineAdapter(new UnrealEngineAdapter());
