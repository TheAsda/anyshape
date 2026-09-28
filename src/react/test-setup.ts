// Shared setup for the React binding tests (run under the DOM environment from --dom).
import { vi } from "vitest";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
document.body.innerHTML = '<div id="root"></div>';
