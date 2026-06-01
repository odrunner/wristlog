import { assertEquals } from "jsr:@std/assert";
import {
  extractJson,
  isValidBrandName,
  parseBrandRequest,
  pickFinalBrandName,
  sanitizeBrandName,
} from "./lib.ts";

Deno.test("extractJson — parses an embedded JSON object", () => {
  assertEquals(extractJson('ok {"is_brand": true, "canonical_name": "Rolex"} done'), {
    is_brand: true,
    canonical_name: "Rolex",
  });
});

Deno.test("extractJson — returns null when no object present", () => {
  assertEquals(extractJson("no json here"), null);
});

Deno.test("extractJson — spans multiple lines", () => {
  assertEquals(extractJson('x\n{\n "is_brand": false\n}\ny'), { is_brand: false });
});

Deno.test("parseBrandRequest — extracts the requested brand name", () => {
  assertEquals(
    parseBrandRequest('Please add "Anoma" to the WRotate brand list'),
    "Anoma",
  );
});

Deno.test("parseBrandRequest — case-insensitive match", () => {
  assertEquals(
    parseBrandRequest('please ADD "Ming" to the wrotate BRAND list'),
    "Ming",
  );
});

Deno.test("parseBrandRequest — null for non-brand titles", () => {
  assertEquals(parseBrandRequest("Bug report: app crashes"), null);
  assertEquals(parseBrandRequest(null), null);
  assertEquals(parseBrandRequest(undefined), null);
  assertEquals(parseBrandRequest(""), null);
});

Deno.test("parseBrandRequest — captures multi-word brand names", () => {
  assertEquals(
    parseBrandRequest('Please add "Grand Seiko" to the WRotate brand list'),
    "Grand Seiko",
  );
});

Deno.test("sanitizeBrandName — trims whitespace", () => {
  assertEquals(sanitizeBrandName("  Rolex  "), "Rolex");
});

Deno.test("sanitizeBrandName — converts smart single quotes to ASCII", () => {
  assertEquals(sanitizeBrandName("O’Clock"), "O'Clock");
  assertEquals(sanitizeBrandName("‘Test’"), "'Test'");
});

Deno.test("sanitizeBrandName — converts smart double quotes to ASCII", () => {
  assertEquals(sanitizeBrandName("“Brand”"), '"Brand"');
});

Deno.test("isValidBrandName — accepts letters, numbers, spaces, dash, dot, amp, apostrophe", () => {
  assertEquals(isValidBrandName("Rolex"), true);
  assertEquals(isValidBrandName("Bell & Ross"), true);
  assertEquals(isValidBrandName("A. Lange & Sohne"), true);
  assertEquals(isValidBrandName("Jaeger-LeCoultre"), true);
  assertEquals(isValidBrandName("O'Clock"), true);
  assertEquals(isValidBrandName("Seiko 5"), true);
});

Deno.test("isValidBrandName — rejects unsafe characters", () => {
  assertEquals(isValidBrandName("Rolex<script>"), false);
  assertEquals(isValidBrandName("Brand;DROP TABLE"), false);
  assertEquals(isValidBrandName("Brand/Slash"), false);
  assertEquals(isValidBrandName(""), false);
});

Deno.test("pickFinalBrandName — prefers canonical name", () => {
  assertEquals(pickFinalBrandName("Rolex", "rolex"), "Rolex");
});

Deno.test("pickFinalBrandName — falls back to requested when canonical missing", () => {
  assertEquals(pickFinalBrandName(null, "Anoma"), "Anoma");
  assertEquals(pickFinalBrandName(undefined, "Anoma"), "Anoma");
  assertEquals(pickFinalBrandName("", "Anoma"), "Anoma");
});
