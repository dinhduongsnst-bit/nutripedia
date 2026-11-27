// File tinh_toan_who.js — Bộ tính Z-score dùng chung cho mọi chế độ của Nutripedia.
// Làm theo đúng thuật toán của WHO Anthro (trẻ < 60 tháng, WHO 2006)
// và WHO AnthroPlus (trẻ từ 60 tháng đến 19 tuổi, WHO 2007).
// Cần nạp du_lieu_who_chi_tiet.js trước file này.
(function (root) {
  "use strict";

  const DAYS_PER_MONTH = 30.4375;        // WHO quy đổi 1 tháng = 30,4375 ngày
  const UNDER5_MAX_DAYS = 1856;          // bảng WHO 2006 theo ngày: 0–1856
  const OVER5_MIN_MONTHS = 60;           // quy định: tròn 60 tháng = 5 tuổi → dùng WHO 2007 (BMI/tuổi)
  const MAX_MONTHS = 228;                // 19 tuổi
  const LYING_MAX_DAYS = 731;            // < 731 ngày (< 24 tháng) chuẩn là đo nằm
  const LENHEI_ADJUST = 0.7;             // chênh lệch nằm − đứng theo WHO
  const WFL_RANGE = [45, 110];
  const WFH_RANGE = [65, 120];

  function detail() {
    // const ở cấp cao nhất của script khác không gắn vào window, nên đọc theo tên trước.
    return typeof WHO_DETAIL !== "undefined" ? WHO_DETAIL : root.WHO_DETAIL;
  }

  // Lấy bộ L, M, S tại vị trí x; nội suy tuyến tính khi x nằm giữa hai dòng (như WHO).
  function lmsAt(tableName, gender, x) {
    const table = detail() && detail()[tableName];
    const values = table && table[gender];
    if (!values || !Number.isFinite(x)) return null;
    const count = values.length / 3;
    const position = Math.round(((x - table.start) / table.step) * 1e6) / 1e6;
    if (position < 0 || position > count - 1) return null;
    const low = Math.floor(position);
    const fraction = position - low;
    const pick = index => ({ L: values[index * 3], M: values[index * 3 + 1], S: values[index * 3 + 2] });
    const a = pick(low);
    if (fraction < 1e-9) return { ...a, age: x };
    const b = pick(low + 1);
    return {
      L: a.L + fraction * (b.L - a.L),
      M: a.M + fraction * (b.M - a.M),
      S: a.S + fraction * (b.S - a.S),
      age: x
    };
  }

  function valueAtZ(row, z) {
    if (!row) return null;
    const { L, M, S } = row;
    if (L === 0) return M * Math.exp(S * z);
    const base = 1 + L * S * z;
    return base > 0 ? M * Math.pow(base, 1 / L) : null;
  }

  function zRaw(value, row) {
    if (!row || !Number.isFinite(value) || value <= 0) return null;
    const { L, M, S } = row;
    const z = L === 0 ? Math.log(value / M) / S : (Math.pow(value / M, L) - 1) / (L * S);
    return Number.isFinite(z) ? z : null;
  }

  // Z-score "điều chỉnh" của WHO cho cân nặng và BMI khi |Z| > 3.
  function zRestricted(value, row) {
    const z = zRaw(value, row);
    if (z === null) return null;
    if (z > 3) {
      const sd3 = valueAtZ(row, 3);
      return 3 + (value - sd3) / (sd3 - valueAtZ(row, 2));
    }
    if (z < -3) {
      const sd3 = valueAtZ(row, -3);
      return -3 + (value - sd3) / (valueAtZ(row, -2) - sd3);
    }
    return z;
  }

  function round2(z) {
    return Number.isFinite(z) ? Math.round(z * 100) / 100 : null;
  }

  // ---------- TUỔI ----------
  // Một "tuổi" gồm: completedMonths (tháng tròn, dùng để chọn nhóm),
  // months (tháng thập phân, dùng cho WHO 2007) và days (ngày, dùng cho WHO 2006).
  function ageFromMonths(months) {
    if (!Number.isFinite(months) || months < 0) return null;
    return {
      completedMonths: Math.floor(months + 1e-9),
      months,
      days: Math.floor(months * DAYS_PER_MONTH + 0.5),
      exactDays: false
    };
  }

  function ageFromDays(days) {
    if (!Number.isFinite(days) || days < 0) return null;
    const months = days / DAYS_PER_MONTH;
    return { completedMonths: Math.floor(months + 1e-9), months, days: Math.round(days), exactDays: true };
  }

  function ageFromBirthDate(birthDate, referenceDate = new Date()) {
    if (!birthDate || typeof birthDate.getTime !== "function" || Number.isNaN(birthDate.getTime())) return null;
    const birth = Date.UTC(birthDate.getFullYear(), birthDate.getMonth(), birthDate.getDate());
    const ref = Date.UTC(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate());
    const days = Math.round((ref - birth) / 86400000);
    if (days < 0) return null;
    let completedMonths = (referenceDate.getFullYear() - birthDate.getFullYear()) * 12
      + (referenceDate.getMonth() - birthDate.getMonth());
    if (referenceDate.getDate() < birthDate.getDate()) completedMonths -= 1;
    return { completedMonths, months: days / DAYS_PER_MONTH, days, exactDays: true };
  }

  function isOver5(age) {
    return Boolean(age) && age.completedMonths >= OVER5_MIN_MONTHS;
  }

  function ageInRange(age) {
    return Boolean(age) && age.completedMonths >= 0 && age.completedMonths <= MAX_MONTHS;
  }

  function ageText(age) {
    if (!age) return "";
    const m = age.completedMonths;
    if (m < OVER5_MIN_MONTHS) {
      if (age.exactDays && m < 1) return `${age.days} ngày`;
      return `${m} tháng`;
    }
    const years = Math.floor(m / 12);
    const rest = m % 12;
    return rest ? `${years} tuổi ${rest} tháng` : `${years} tuổi`;
  }

  // Nhập tuổi nhanh. unit = "month" | "year".
  //   Tháng: 0–228 (gõ đúng số tháng HIS hiện, ví dụ 63)
  //   Tuổi : 7 → 7 tuổi; 7.11 hoặc 7,11 hoặc "7 11" → 7 tuổi 11 tháng
  //   Ghi rõ đơn vị luôn được ưu tiên: "20 ngày", "63 tháng", "5 tuổi 3 tháng", "5t3"
  function parseAgeEntry(raw, unit) {
    const text = String(raw ?? "").trim().toLowerCase().replace(/\s+/g, " ");
    if (!text) return { empty: true };
    const fail = error => ({ error });
    const fromMonths = (years, months) => {
      if (months > 11) return fail("Số tháng lẻ phải từ 0 đến 11.");
      const total = years * 12 + months;
      if (total > MAX_MONTHS) return fail("Tuổi tối đa là 19 tuổi (228 tháng).");
      return { age: ageFromMonths(total) };
    };

    let match = text.match(/^(\d{1,4})\s*(?:n|ng|ngày|ngay|d|days?)$/u);
    if (match) {
      const days = Number(match[1]);
      if (days > MAX_MONTHS * DAYS_PER_MONTH) return fail("Tuổi tối đa là 19 tuổi (228 tháng).");
      return { age: ageFromDays(days) };
    }
    match = text.match(/^(\d{1,3})\s*(?:th|tháng|thang|m|months?)$/u);
    if (match) {
      const months = Number(match[1]);
      if (months > MAX_MONTHS) return fail("Tháng tuổi tối đa là 228 (19 tuổi).");
      return { age: ageFromMonths(months) };
    }
    match = text.match(/^(\d{1,2})\s*(?:t|tuổi|tuoi|năm|nam|y|years?)\s*(?:(\d{1,2})\s*(?:th|tháng|thang|m|months?)?)?$/u);
    if (match) return fromMonths(Number(match[1]), Number(match[2] || 0));

    match = text.match(/^(\d{1,3})(?:\s*[.,\-\/ ]\s*(\d{1,2}))?$/u);
    if (!match) return fail(unit === "year"
      ? "Nhập tuổi dạng 7 hoặc 7.11 (7 tuổi 11 tháng)."
      : "Nhập số tháng tuổi từ 0 đến 228.");
    const first = Number(match[1]);
    const second = match[2] === undefined ? null : Number(match[2]);
    if (unit === "year") {
      if (first > 19) return fail("Tuổi tối đa là 19. Nếu là số tháng, bấm nút để chuyển sang Tháng.");
      return fromMonths(first, second ?? 0);
    }
    if (second !== null) return fail("Tháng tuổi là số nguyên. Muốn nhập tuổi và tháng, bấm nút để chuyển sang Tuổi (ví dụ 5.3).");
    if (first > MAX_MONTHS) return fail("Tháng tuổi tối đa là 228 (19 tuổi).");
    return { age: ageFromMonths(first) };
  }

  // Viết tuổi lại vào ô nhập theo đơn vị đang chọn.
  function formatAgeEntry(age, unit) {
    if (!age) return "";
    const m = age.completedMonths;
    if (unit === "year") {
      const years = Math.floor(m / 12);
      const rest = m % 12;
      return rest ? `${years}.${rest}` : String(years);
    }
    return String(m);
  }

  // ---------- ĐO NẰM / ĐO ĐỨNG ----------
  function recommendedMeasure(age) {
    if (!age || isOver5(age)) return "h";
    return Math.min(age.days, UNDER5_MAX_DAYS) < LYING_MAX_DAYS ? "l" : "h";
  }

  // ---------- ĐÁNH GIÁ ----------
  // input: { gender: 1|2, age, weight (kg), height (cm), measure: "l" | "h" | null }
  function assess(input) {
    const { gender, age, weight, height } = input;
    if (![1, 2].includes(gender) || !ageInRange(age) || !(weight > 0) || !(height > 0)) return null;
    const bmi = weight / Math.pow(height / 100, 2);

    if (isOver5(age)) {
      const months = Math.min(MAX_MONTHS, Math.max(OVER5_MIN_MONTHS, age.months));
      const hfaRow = lmsAt("hfa2007", gender, months);
      const bfaRow = lmsAt("bfa2007", gender, months);
      return {
        group: "over5",
        bmi,
        measure: "h",
        recommendedMeasure: "h",
        heightAdjustment: 0,
        adjustedHeight: height,
        chartAgeMonths: months,
        hfa: { z: round2(zRaw(height, hfaRow)), row: hfaRow, x: months, value: height },
        bfa: { z: round2(zRestricted(bmi, bfaRow)), row: bfaRow, x: months, value: bmi }
      };
    }

    const days = Math.min(age.days, UNDER5_MAX_DAYS);
    const recommended = days < LYING_MAX_DAYS ? "l" : "h";
    const measure = input.measure === "l" || input.measure === "h" ? input.measure : recommended;
    let heightAdjustment = 0;
    if (measure === "h" && days < LYING_MAX_DAYS) heightAdjustment = LENHEI_ADJUST;
    if (measure === "l" && days >= LYING_MAX_DAYS) heightAdjustment = -LENHEI_ADJUST;
    const lenhei = Math.round((height + heightAdjustment) * 1000) / 1000;

    const wfaRow = lmsAt("wfa", gender, days);
    const hfaRow = lmsAt("lhfa", gender, days);
    const wfhTable = days < LYING_MAX_DAYS ? "wfl" : "wfh";
    const wfhRange = wfhTable === "wfl" ? WFL_RANGE : WFH_RANGE;
    const wfhInRange = lenhei >= wfhRange[0] && lenhei <= wfhRange[1];
    const wfhRow = wfhInRange ? lmsAt(wfhTable, gender, lenhei) : null;
    const chartAgeMonths = days / DAYS_PER_MONTH;

    return {
      group: "under5",
      bmi,
      measure,
      recommendedMeasure: recommended,
      heightAdjustment,
      adjustedHeight: lenhei,
      chartAgeMonths,
      wfa: { z: round2(zRestricted(weight, wfaRow)), row: wfaRow, x: chartAgeMonths, value: weight },
      hfa: { z: round2(zRaw(lenhei, hfaRow)), row: hfaRow, x: chartAgeMonths, value: lenhei },
      wfh: {
        z: round2(zRestricted(weight, wfhRow)),
        row: wfhRow,
        x: lenhei,
        value: weight,
        table: wfhTable,
        range: wfhRange,
        inRange: wfhInRange
      }
    };
  }

  // Dòng LMS dùng cho gợi ý mốc SD và biểu đồ (không cần cân nặng/chiều cao).
  function referenceRow(kind, gender, age, heightValue) {
    if (![1, 2].includes(gender) || !ageInRange(age)) return null;
    if (isOver5(age)) {
      const months = Math.min(MAX_MONTHS, Math.max(OVER5_MIN_MONTHS, age.months));
      if (kind === "hfa") return lmsAt("hfa2007", gender, months);
      if (kind === "bfa") return lmsAt("bfa2007", gender, months);
      return null;
    }
    const days = Math.min(age.days, UNDER5_MAX_DAYS);
    if (kind === "wfa") return lmsAt("wfa", gender, days);
    if (kind === "hfa") return lmsAt("lhfa", gender, days);
    if (kind === "wfh" && Number.isFinite(heightValue)) {
      const table = days < LYING_MAX_DAYS ? "wfl" : "wfh";
      const range = table === "wfl" ? WFL_RANGE : WFH_RANGE;
      return heightValue >= range[0] && heightValue <= range[1] ? lmsAt(table, gender, heightValue) : null;
    }
    return null;
  }

  // Tập điểm cho biểu đồ: x theo tháng (tuổi) hoặc cm (chiều dài/cao).
  const chartCache = {};
  function chartRows(kind, gender) {
    const key = `${kind}-${gender}`;
    if (chartCache[key]) return chartCache[key];
    const rows = [];
    const push = (x, row) => { if (row) rows.push({ gender, age: x, L: row.L, M: row.M, S: row.S }); };
    if (kind === "wfa" || kind === "lhfa") {
      for (let month = 0; month <= 60; month += 0.5) {
        push(month, lmsAt(kind, gender, Math.min(UNDER5_MAX_DAYS, Math.floor(month * DAYS_PER_MONTH + 0.5))));
      }
    } else if (kind === "wfl" || kind === "wfh") {
      const range = kind === "wfl" ? WFL_RANGE : WFH_RANGE;
      for (let cm = range[0]; cm <= range[1] + 1e-9; cm += 0.5) push(Math.round(cm * 10) / 10, lmsAt(kind, gender, cm));
    } else if (kind === "hfa2007" || kind === "bfa2007") {
      for (let month = OVER5_MIN_MONTHS; month <= MAX_MONTHS; month += 1) push(month, lmsAt(kind, gender, month));
    }
    chartCache[key] = rows;
    return rows;
  }

  root.NutriWHO = {
    DAYS_PER_MONTH,
    OVER5_MIN_MONTHS,
    MAX_MONTHS,
    WFL_RANGE,
    WFH_RANGE,
    lmsAt,
    valueAtZ,
    zRaw,
    zRestricted,
    ageFromMonths,
    ageFromDays,
    ageFromBirthDate,
    isOver5,
    ageInRange,
    ageText,
    parseAgeEntry,
    formatAgeEntry,
    recommendedMeasure,
    assess,
    referenceRow,
    chartRows
  };
})(typeof window !== "undefined" ? window : globalThis);
