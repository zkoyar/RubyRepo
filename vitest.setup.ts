import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// La pulizia automatica di testing-library si aggancia da sola solo con
// `globals: true`. Qui i globali restano disattivati — gli import espliciti
// rendono evidente da dove arriva ogni cosa — quindi va registrata a mano:
// senza, ogni test troverebbe anche il DOM lasciato dai precedenti.
afterEach(cleanup);
