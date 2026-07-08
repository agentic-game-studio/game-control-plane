import { registerEngineAdapter } from "../services/engine-adapter-factory.js";
import { GodotEngineAdapter } from "./godot-adapter.js";

registerEngineAdapter(new GodotEngineAdapter());
