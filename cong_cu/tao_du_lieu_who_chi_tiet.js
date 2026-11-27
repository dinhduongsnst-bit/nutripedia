#!/usr/bin/env node
// Sinh file du_lieu_who_chi_tiet.js từ bảng LMS chính thức của WHO.
//
// Nguồn (WHO công bố, giấy phép GPL-3):
//   https://github.com/WorldHealthOrganization/anthro      → data-raw/growthstandards/
//     weianthro.txt  Cân nặng/tuổi 0–1856 ngày (WHO 2006)
//     lenanthro.txt  Chiều dài-cao/tuổi 0–1856 ngày (L <731 ngày, H từ 731 ngày)
//     wflanthro.txt  Cân nặng/chiều dài 45–110 cm, bước 0,1 cm (đo nằm)
//     wfhanthro.txt  Cân nặng/chiều cao 65–120 cm, bước 0,1 cm (đo đứng)
//   https://github.com/WorldHealthOrganization/anthroplus  → data-raw/growthstandards/
//     hfawho2007.txt Chiều cao/tuổi 60–228 tháng (WHO 2007)
//     bfawho2007.txt BMI/tuổi 60–228 tháng (WHO 2007)
//     wfawho2007.txt Cân nặng/tuổi 60–120 tháng (WHO 2007)
//
// Cách chạy:
//   node cong_cu/tao_du_lieu_who_chi_tiet.js <thư mục anthro> <thư mục anthroplus>
"use strict";
const fs = require("fs");
const path = require("path");

const [anthroDir, anthroplusDir] = process.argv.slice(2);
if (!anthroDir || !anthroplusDir) {
  console.error("Cách dùng: node tao_du_lieu_who_chi_tiet.js <anthro> <anthroplus>");
  process.exit(1);
}

function readTable(file) {
  const lines = fs.readFileSync(file, "utf8").trim().split(/\r?\n/);
  const header = lines.shift().split("\t");
  return lines.map(line => {
    const cells = line.split("\t");
    const row = {};
    header.forEach((key, index) => { row[key] = cells[index]; });
    return row;
  });
}

// Mỗi bảng: { start, step, 1: [L,M,S,L,M,S,...], 2: [...] }
function pack(rows, keyName, start, step) {
  const table = { start, step, 1: [], 2: [] };
  for (const sex of [1, 2]) {
    const own = rows.filter(row => Number(row.sex) === sex);
    own.forEach((row, index) => {
      const expected = Number((start + index * step).toFixed(1));
      if (Math.abs(Number(row[keyName]) - expected) > 1e-6) {
        throw new Error(`Bảng không liên tục tại ${keyName}=${row[keyName]} (mong đợi ${expected})`);
      }
      table[sex].push(Number(row.l), Number(row.m), Number(row.s));
    });
  }
  return table;
}

const gs = dir => path.join(dir, "data-raw", "growthstandards");
const data = {
  wfa: pack(readTable(path.join(gs(anthroDir), "weianthro.txt")), "age", 0, 1),
  lhfa: pack(readTable(path.join(gs(anthroDir), "lenanthro.txt")), "age", 0, 1),
  wfl: pack(readTable(path.join(gs(anthroDir), "wflanthro.txt")), "length", 45, 0.1),
  wfh: pack(readTable(path.join(gs(anthroDir), "wfhanthro.txt")), "height", 65, 0.1),
  hfa2007: pack(readTable(path.join(gs(anthroplusDir), "hfawho2007.txt")), "age", 60, 1),
  bfa2007: pack(readTable(path.join(gs(anthroplusDir), "bfawho2007.txt")), "age", 60, 1),
  wfa2007: pack(readTable(path.join(gs(anthroplusDir), "wfawho2007.txt")), "age", 60, 1)
};

const out = [
  "// File du_lieu_who_chi_tiet.js — SINH TỰ ĐỘNG, KHÔNG SỬA TAY.",
  "// Tạo bằng cong_cu/tao_du_lieu_who_chi_tiet.js từ bảng LMS chính thức của WHO",
  "// (gói anthro cho WHO 2006, gói anthroplus cho WHO 2007).",
  "// Mỗi bảng: start = giá trị đầu, step = bước; mảng theo giới (1 nam, 2 nữ) gồm các bộ L, M, S liên tiếp.",
  "//   wfa, lhfa : theo NGÀY tuổi 0–1856",
  "//   wfl       : cân nặng/chiều dài nằm 45–110 cm (bước 0,1)",
  "//   wfh       : cân nặng/chiều cao đứng 65–120 cm (bước 0,1)",
  "//   hfa2007, bfa2007, wfa2007 : theo THÁNG tuổi từ 60",
  "const WHO_DETAIL = {"
];
const keys = Object.keys(data);
keys.forEach((key, keyIndex) => {
  const table = data[key];
  out.push(`  ${key}: {`);
  out.push(`    start: ${table.start}, step: ${table.step},`);
  out.push(`    1: [${table[1].join(",")}],`);
  out.push(`    2: [${table[2].join(",")}]`);
  out.push(`  }${keyIndex < keys.length - 1 ? "," : ""}`);
});
out.push("};", "");

const target = path.join(__dirname, "..", "du_lieu_who_chi_tiet.js");
fs.writeFileSync(target, out.join("\n"));
console.log("Đã ghi", target, (fs.statSync(target).size / 1024).toFixed(0), "KB");
