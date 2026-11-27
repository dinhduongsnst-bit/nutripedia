#!/usr/bin/env node
// Kiểm tra bộ tính Z-score của Nutripedia.
// Chạy: node kiem_tra/kiem_tra_who.js
//
// 1. WHO 2007 (≥ 60 tháng): so với 933 trẻ mẫu WHO AnthroPlus đã tính sẵn
//    (mau_who_anthroplus_2007.csv, lấy từ gói anthroplus của WHO).
// 2. WHO 2006 (< 60 tháng): so mốc −3…+3 SD với bảng SD WHO đã công bố (du_lieu_chuan_who.js).
// 3. Quy đổi đo nằm/đứng, ranh giới 60 tháng, bảng CN/CC theo tuổi, nhập tuổi.
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const context = { console };
context.globalThis = context;
vm.createContext(context);
for (const file of ["du_lieu_chuan_who.js", "du_lieu_who_chi_tiet.js", "tinh_toan_who.js"]) {
  vm.runInContext(fs.readFileSync(path.join(root, file), "utf8") + "\n;globalThis.WHO_DATA = typeof WHO_DATA !== 'undefined' ? WHO_DATA : globalThis.WHO_DATA; globalThis.WHO_DETAIL = typeof WHO_DETAIL !== 'undefined' ? WHO_DETAIL : globalThis.WHO_DETAIL;", context, { filename: file });
}
const W = context.NutriWHO;
const WHO_DATA = context.WHO_DATA;

let failures = 0;
let checks = 0;
function check(condition, message) {
  checks += 1;
  if (!condition) {
    failures += 1;
    if (failures <= 30) console.log("  ✗", message);
  }
}
const near = (a, b, tol) => a !== null && b !== null && Math.abs(a - b) <= tol + 1e-9;

// ---------- 1. AnthroPlus ----------
{
  const lines = fs.readFileSync(path.join(__dirname, "mau_who_anthroplus_2007.csv"), "utf8").trim().split(/\r?\n/);
  const header = lines.shift().split(",").map(cell => cell.replace(/"/g, ""));
  let compared = 0;
  for (const line of lines) {
    const cells = line.split(",").map(cell => cell.replace(/"/g, ""));
    const row = Object.fromEntries(header.map((key, index) => [key, cells[index]]));
    const months = Number(row.agemons);
    const sex = Number(row.sex);
    const weight = Number(row.weight);
    const height = Number(row.height);
    if (!Number.isFinite(months) || !Number.isFinite(height) || ![1, 2].includes(sex)) continue;
    if (months < 61 || months >= 229) continue;
    const age = W.ageFromMonths(months);
    const result = W.assess({ gender: sex, age, weight: Number.isFinite(weight) && weight > 0 ? weight : 1, height, measure: null });
    if (row.zhfa !== "") {
      compared += 1;
      check(near(result.hfa.z, Number(row.zhfa), 0.011), `AnthroPlus id ${row.id}: CC/T ${result.hfa.z} ≠ ${row.zhfa}`);
    }
    if (row.zbfa !== "" && row.oedema !== "y" && weight > 0) {
      compared += 1;
      check(near(result.bfa.z, Number(row.zbfa), 0.011), `AnthroPlus id ${row.id}: BMI/T ${result.bfa.z} ≠ ${row.zbfa}`);
    }
  }
  console.log(`WHO AnthroPlus: đã so ${compared} Z-score`);
}

// ---------- 2. Bảng SD WHO 2006 đã công bố ----------
{
  const fields = [["sd3_am", -3], ["sd2_am", -2], ["sd1_am", -1], ["sd0", 0], ["sd1_duong", 1], ["sd2_duong", 2], ["sd3_duong", 3]];
  let compared = 0;
  let maxDiff = 0;
  const compare = (label, published, row) => {
    for (const [field, z] of fields) {
      if (!Number.isFinite(published[field])) continue;
      compared += 1;
      const value = W.valueAtZ(row, z);
      // bảng WHO in theo tháng, làm tròn 1 chữ số; bảng theo ngày lệch dưới 0,1
      maxDiff = Math.max(maxDiff, Math.abs(value - published[field]));
      check(near(value, published[field], 0.1), `${label} ${field}: ${value && value.toFixed(3)} ≠ ${published[field]}`);
    }
  };
  for (const published of WHO_DATA.wfa) {
    const age = W.ageFromMonths(published.age);
    compare(`CN/T ${published.gender} ${published.age} tháng`, published, W.lmsAt("wfa", published.gender, age.days));
  }
  for (const published of WHO_DATA.hfa) {
    const age = W.ageFromMonths(published.age);
    compare(`CC/T ${published.gender} ${published.age} tháng`, published, W.lmsAt("lhfa", published.gender, age.days));
  }
  // Bảng wfh cũ của app là bảng ghép: 45–64,5 cm theo bảng đo nằm, 65–110 cm theo bảng đo đứng.
  for (const published of WHO_DATA.wfh) {
    const table = published.age < 65 ? "wfl" : "wfh";
    compare(`CN/CC ${published.gender} ${published.age} cm`, published, W.lmsAt(table, published.gender, published.age));
  }
  console.log(`Bảng SD WHO 2006: đã so ${compared} mốc, lệch lớn nhất ${maxDiff.toFixed(3)} (bảng in làm tròn 0,1 theo tháng)`);
}

// ---------- 3. Tình huống lâm sàng ----------
{
  const months = m => W.ageFromMonths(m);
  // Ranh giới 60 tháng
  check(!W.isOver5(months(59)), "59 tháng phải dùng WHO 2006");
  check(W.isOver5(months(60)), "60 tháng phải dùng WHO 2007 (BMI/tuổi)");
  check(W.assess({ gender: 1, age: months(60), weight: 18, height: 110 }).group === "over5", "60 tháng → nhóm BMI/tuổi");
  check(W.assess({ gender: 1, age: months(63), weight: 18, height: 110 }).group === "over5", "63 tháng (HIS) → nhóm BMI/tuổi");

  // CN/CC: trẻ 58 tháng cao 112 cm phải tính được (bảng đo đứng 65–120 cm)
  const r58 = W.assess({ gender: 1, age: months(58), weight: 18, height: 112 });
  check(r58.wfh.z !== null && r58.wfh.table === "wfh", "58 tháng cao 112 cm phải có CN/CC (bảng đo đứng)");

  // Quy đổi đo nằm/đứng ±0,7 cm
  const standingYoung = W.assess({ gender: 2, age: months(18), weight: 10, height: 80, measure: "h" });
  check(near(standingYoung.adjustedHeight, 80.7, 1e-9), "18 tháng đo đứng 80 cm → 80,7 cm");
  const lyingOld = W.assess({ gender: 2, age: months(30), weight: 12, height: 90, measure: "l" });
  check(near(lyingOld.adjustedHeight, 89.3, 1e-9), "30 tháng đo nằm 90 cm → 89,3 cm");
  const defaultOld = W.assess({ gender: 2, age: months(30), weight: 12, height: 90 });
  check(defaultOld.measure === "h" && defaultOld.heightAdjustment === 0, "30 tháng mặc định đo đứng, không quy đổi");

  // Trẻ 7 tuổi 11 tháng không còn bị làm tròn xuống 7 tuổi
  const exact = W.assess({ gender: 1, age: months(95), weight: 22, height: 120 });
  check(near(exact.hfa.z, -1.21, 0.011), `95 tháng cao 120 cm: CC/T ${exact.hfa.z} (mong đợi −1,21)`);

  // Nhập tuổi
  const parse = (text, unit) => {
    const result = W.parseAgeEntry(text, unit);
    return result.age ? result.age.completedMonths : result.error ? "lỗi" : "trống";
  };
  const cases = [
    ["63", "month", 63], ["228", "month", 228], ["229", "month", "lỗi"], ["7", "year", 84],
    ["7.11", "year", 95], ["7,11", "year", 95], ["7 11", "year", 95], ["7.12", "year", "lỗi"],
    ["5 tuổi 3 tháng", "month", 63], ["5t3", "year", 63], ["63 tháng", "year", 63],
    ["20 ngày", "month", 0], ["3.5", "month", "lỗi"], ["", "month", "trống"], ["2", "year", 24]
  ];
  for (const [text, unit, expected] of cases) {
    check(parse(text, unit) === expected, `Nhập "${text}" (${unit}) → ${parse(text, unit)}, mong đợi ${expected}`);
  }
  check(W.formatAgeEntry(months(95), "year") === "7.11", "Viết lại 95 tháng ở ô Tuổi là 7.11");

  // Ngày sinh: tròn 5 tuổi đúng ngày sinh nhật → nhóm BMI/tuổi
  const birthday = W.ageFromBirthDate(new Date(2020, 3, 23), new Date(2025, 3, 23));
  check(birthday.completedMonths === 60 && W.isOver5(birthday), "Sinh nhật 5 tuổi → 60 tháng, nhóm BMI/tuổi");
  const dayBefore = W.ageFromBirthDate(new Date(2020, 3, 23), new Date(2025, 3, 22));
  check(dayBefore.completedMonths === 59 && !W.isOver5(dayBefore), "Trước sinh nhật 5 tuổi 1 ngày → 59 tháng");
}

console.log(`\n${checks - failures}/${checks} kiểm tra đạt.`);
if (failures) {
  console.log(`${failures} kiểm tra KHÔNG đạt.`);
  process.exit(1);
}
