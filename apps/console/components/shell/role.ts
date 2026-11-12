"use client";

import { createContext, use } from "react";

/** The person's role in the organization, such as "owner" or "member". */
export const RoleContext = createContext("member");
export const useRole = () => use(RoleContext);
