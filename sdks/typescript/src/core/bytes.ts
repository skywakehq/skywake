const encoder = new TextEncoder();

export const utf8 = (text: string) => encoder.encode(text);
