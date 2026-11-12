"use client";

import { createContext, use } from "react";
import type { AuthOptions } from "@/server/hosted";

// Off unless the server says otherwise: a self-hosted console offers neither.
const Options = createContext<AuthOptions>({ email: false, social: [] });

export const AuthOptionsProvider = Options;
export const useAuthOptions = () => use(Options);
