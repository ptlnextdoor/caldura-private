use crate::types::{AttrSpec, Finish, Material, ProductType, Standard};
use once_cell::sync::Lazy;
use regex::Regex;
use std::collections::HashSet;

static METRIC_THREAD: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"\bm\s?(\d+(?:\.\d+)?)(?:[-\s](\d+\.\d+))?\b").unwrap());
static IMPERIAL_THREAD: Lazy<Regex> = Lazy::new(|| Regex::new(r"\b(\d+/\d+)-(\d+)\b").unwrap());
static NUMBERED_THREAD: Lazy<Regex> = Lazy::new(|| Regex::new(r"#\s?(\d+)-(\d+)").unwrap());
static BARE_FRACTION: Lazy<Regex> = Lazy::new(|| Regex::new(r"\b(\d+/\d+)\b").unwrap());
static METRIC_LENGTH: Lazy<Regex> = Lazy::new(|| Regex::new(r"\b(\d+(?:\.\d+)?)\s*mm\b").unwrap());
static IMPERIAL_LENGTH: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r#"\b(\d+(?:-\d+/\d+)?|\d+/\d+)(?:\s*)(?:"|in|inch|inches)\b"#).unwrap()
});
static FOOT_LENGTH: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"\b(\d+(?:\.\d+)?)\s*(?:ft|feet|foot|')\b").unwrap());

pub fn parse_query(text: &str) -> AttrSpec {
    parse_text(text)
}

pub fn parse_catalog_row(description: &str) -> AttrSpec {
    parse_text(description)
}

pub fn normalize(text: &str) -> String {
    let lower = text
        .to_ascii_lowercase()
        .replace('×', " x ")
        .replace('“', "\"")
        .replace('”', "\"")
        .replace(',', " ")
        .replace('/', "/");
    let mut compact = String::with_capacity(lower.len());
    let mut previous_space = false;
    for ch in lower.chars() {
        let mapped = match ch {
            '\n' | '\t' | '\r' => ' ',
            _ => ch,
        };
        if mapped.is_whitespace() {
            if !previous_space {
                compact.push(' ');
                previous_space = true;
            }
        } else {
            compact.push(mapped);
            previous_space = false;
        }
    }
    compact.trim().to_string()
}

pub fn tokens(text: &str) -> Vec<String> {
    let normalized = normalize(text)
        .replace('"', " ")
        .replace('(', " ")
        .replace(')', " ");
    normalized
        .split_whitespace()
        .flat_map(|token| {
            let cleaned = token.trim_matches(|ch: char| {
                !ch.is_ascii_alphanumeric() && ch != '/' && ch != '-' && ch != '#'
            });
            expand_token(cleaned)
        })
        .filter(|token| token.len() > 1 || token == "x")
        .collect()
}

fn expand_token(token: &str) -> Vec<String> {
    let mut out = Vec::new();
    if token.is_empty() {
        return out;
    }
    out.push(token.to_string());
    match token {
        "hx" => out.extend(["hex".to_string(), "head".to_string()]),
        "soc" => out.push("socket".to_string()),
        "scr" => out.push("screw".to_string()),
        "hcs" => out.extend(["hex".to_string(), "cap".to_string(), "screw".to_string()]),
        "fw" => out.extend(["flat".to_string(), "washer".to_string()]),
        "wshr" => out.push("washer".to_string()),
        "btn" => out.push("button".to_string()),
        "phil" => out.push("phillips".to_string()),
        "mach" => out.push("machine".to_string()),
        "washers" => out.push("washer".to_string()),
        "nuts" => out.push("nut".to_string()),
        "screws" => out.push("screw".to_string()),
        "hdg" => out.extend([
            "hot".to_string(),
            "dip".to_string(),
            "galvanized".to_string(),
        ]),
        "galvanized" => out.push("hdg".to_string()),
        "mech" => out.push("mechanical".to_string()),
        "mechanical" => out.push("mech".to_string()),
        "zn" => out.push("zinc".to_string()),
        "yel" => out.push("yellow".to_string()),
        "pln" => out.push("plain".to_string()),
        "ss" => out.push("stainless".to_string()),
        _ => {}
    }
    out
}

fn parse_text(text: &str) -> AttrSpec {
    let normalized = normalize(text);
    let mut consumed = HashSet::new();
    let mut spec = AttrSpec::default();

    if let Some(caps) = METRIC_THREAD.captures(&normalized) {
        let size = caps.get(1).unwrap().as_str();
        let pitch = caps.get(2).map(|m| m.as_str());
        spec.thread_spec = Some(match pitch {
            Some(pitch) => format!("M{}-{}", trim_number(size), trim_number(pitch)),
            None => format!("M{}", trim_number(size)),
        });
        spec.thread_size_normalized = size.parse::<f32>().ok();
        mark_match(&normalized, caps.get(0).unwrap().as_str(), &mut consumed);
    } else if let Some(caps) = IMPERIAL_THREAD.captures(&normalized) {
        let thread = caps.get(0).unwrap().as_str().to_string();
        spec.thread_spec = Some(thread.clone());
        spec.thread_size_normalized = fraction_to_mm(caps.get(1).unwrap().as_str());
        mark_match(&normalized, &thread, &mut consumed);
    } else if let Some(caps) = NUMBERED_THREAD.captures(&normalized) {
        let thread = format!(
            "#{}-{}",
            caps.get(1).unwrap().as_str(),
            caps.get(2).unwrap().as_str()
        );
        spec.thread_spec = Some(thread.clone());
        spec.thread_size_normalized = numbered_screw_mm(caps.get(1).unwrap().as_str());
        mark_match(&normalized, caps.get(0).unwrap().as_str(), &mut consumed);
    } else if let Some(caps) = BARE_FRACTION.captures(&normalized) {
        let size = caps.get(1).unwrap().as_str();
        spec.thread_spec = Some(size.to_string());
        spec.thread_size_normalized = fraction_to_mm(size);
        mark_match(&normalized, size, &mut consumed);
    }

    if let Some(caps) = METRIC_LENGTH.captures(&normalized) {
        let raw = caps.get(0).unwrap().as_str().to_string();
        spec.length_raw = Some(raw.clone());
        spec.length_mm = caps.get(1).unwrap().as_str().parse::<f32>().ok();
        mark_match(&normalized, &raw, &mut consumed);
    } else if let Some(caps) = FOOT_LENGTH.captures(&normalized) {
        let raw = caps.get(0).unwrap().as_str().to_string();
        let ft = caps.get(1).unwrap().as_str().parse::<f32>().unwrap_or(0.0);
        spec.length_raw = Some(raw.clone());
        spec.length_mm = Some(ft * 304.8);
        mark_match(&normalized, &raw, &mut consumed);
    } else if let Some(caps) = IMPERIAL_LENGTH.captures(&normalized) {
        let raw = caps.get(0).unwrap().as_str().to_string();
        spec.length_raw = Some(raw.clone());
        spec.length_mm = imperial_len_to_mm(caps.get(1).unwrap().as_str());
        mark_match(&normalized, &raw, &mut consumed);
    }

    if let Some((value, phrase)) = detect_product_type(&normalized) {
        spec.product_type = Some(value);
        mark_match(&normalized, phrase, &mut consumed);
    }
    if let Some((value, phrase)) = detect_material(&normalized) {
        spec.material = Some(value);
        mark_match(&normalized, phrase, &mut consumed);
    }
    if let Some((value, phrase)) = detect_finish(&normalized) {
        spec.finish = Some(value);
        mark_match(&normalized, phrase, &mut consumed);
    }
    if let Some((value, phrase)) = detect_standard(&normalized) {
        spec.standard = Some(value);
        mark_match(&normalized, phrase, &mut consumed);
    }

    let all_tokens = tokens(&normalized);
    spec.raw_tokens_unconsumed = all_tokens
        .into_iter()
        .filter(|token| !consumed.contains(token))
        .filter(|token| !matches!(token.as_str(), "x" | "class"))
        .collect();

    let filled = [
        spec.thread_spec.is_some(),
        spec.length_mm.is_some(),
        spec.product_type.is_some(),
        spec.material.is_some(),
        spec.finish.is_some(),
        spec.standard.is_some(),
    ]
    .iter()
    .filter(|filled| **filled)
    .count() as f32;
    let mut confidence = filled / 6.0;
    if spec.thread_spec.is_some() {
        confidence *= 1.2;
    }
    if spec.product_type.is_some() {
        confidence += 0.12;
    }
    spec.extraction_confidence = confidence.min(1.0);
    spec
}

fn detect_product_type(text: &str) -> Option<(ProductType, &'static str)> {
    lookup_phrase(
        text,
        &[
            (
                "phillips pan machine screw",
                ProductType::PhillipsPanMachineScrew,
            ),
            (
                "phillips pan mach screw",
                ProductType::PhillipsPanMachineScrew,
            ),
            (
                "phil pan machine screw",
                ProductType::PhillipsPanMachineScrew,
            ),
            ("phil pan mach screw", ProductType::PhillipsPanMachineScrew),
            ("button socket cap screw", ProductType::ButtonSocketCapScrew),
            ("button soc cap screw", ProductType::ButtonSocketCapScrew),
            ("button soc cap scr", ProductType::ButtonSocketCapScrew),
            ("btn socket cap screw", ProductType::ButtonSocketCapScrew),
            ("btn soc cap screw", ProductType::ButtonSocketCapScrew),
            ("btn soc cap scr", ProductType::ButtonSocketCapScrew),
            ("bhcs", ProductType::ButtonSocketCapScrew),
            ("socket head cap screw", ProductType::SocketHeadCapScrew),
            ("socket head cap scr", ProductType::SocketHeadCapScrew),
            ("soc head cap screw", ProductType::SocketHeadCapScrew),
            ("soc head cap scr", ProductType::SocketHeadCapScrew),
            ("shcs", ProductType::SocketHeadCapScrew),
            ("hex head bolt", ProductType::HexHeadBolt),
            ("hx hd bolt", ProductType::HexHeadBolt),
            ("hhb", ProductType::HexHeadBolt),
            ("hex cap screw", ProductType::HexCapScrew),
            ("hex cap scr", ProductType::HexCapScrew),
            ("hx cap screw", ProductType::HexCapScrew),
            ("hx cap scr", ProductType::HexCapScrew),
            ("hcs", ProductType::HexCapScrew),
            ("hex bolt", ProductType::HexCapScrew),
            ("hex nut", ProductType::HexNut),
            ("hex nuts", ProductType::HexNut),
            ("hx nut", ProductType::HexNut),
            ("hx nuts", ProductType::HexNut),
            ("flat washer", ProductType::FlatWasher),
            ("flat washers", ProductType::FlatWasher),
            ("flat wshr", ProductType::FlatWasher),
            ("washers", ProductType::FlatWasher),
            ("washer", ProductType::FlatWasher),
            ("fwsh", ProductType::FlatWasher),
            ("lock washer", ProductType::LockWasher),
            ("lock washers", ProductType::LockWasher),
            ("lock wshr", ProductType::LockWasher),
            ("threaded rod", ProductType::ThreadedRod),
            ("full thread rod", ProductType::ThreadedRod),
            ("thread rod", ProductType::ThreadedRod),
            ("lag screw", ProductType::LagScrew),
            ("lag screws", ProductType::LagScrew),
            ("lag scr", ProductType::LagScrew),
            ("tap bolt", ProductType::TapBolt),
            ("tap bolts", ProductType::TapBolt),
        ],
    )
}

fn detect_material(text: &str) -> Option<(Material, &'static str)> {
    lookup_phrase(
        text,
        &[
            ("18-8 stainless", Material::StainlessSteel18_8),
            ("18 8 stainless", Material::StainlessSteel18_8),
            ("18-8 ss", Material::StainlessSteel18_8),
            ("18 8 ss", Material::StainlessSteel18_8),
            ("316 stainless", Material::StainlessSteel316),
            ("316 ss", Material::StainlessSteel316),
            ("a2 stainless", Material::StainlessSteelA2),
            ("a2 ss", Material::StainlessSteelA2),
            ("steel", Material::Steel),
            ("brass", Material::Brass),
            ("alloy", Material::Alloy),
        ],
    )
}

fn detect_finish(text: &str) -> Option<(Finish, &'static str)> {
    lookup_phrase(
        text,
        &[
            ("yellow zinc", Finish::YellowZinc),
            ("yellow zn", Finish::YellowZinc),
            ("yel zinc", Finish::YellowZinc),
            ("yel zn", Finish::YellowZinc),
            ("mechanical zinc", Finish::MechanicalZinc),
            ("mech zinc", Finish::MechanicalZinc),
            ("mech zn", Finish::MechanicalZinc),
            ("black oxide", Finish::BlackOxide),
            ("hot dip galvanized", Finish::HotDipGalvanized),
            ("hdg", Finish::HotDipGalvanized),
            ("zinc", Finish::Zinc),
            ("zn", Finish::Zinc),
            ("plain", Finish::Plain),
            ("pln", Finish::Plain),
        ],
    )
}

fn detect_standard(text: &str) -> Option<(Standard, &'static str)> {
    lookup_phrase(
        text,
        &[
            ("asme b18.2.1", Standard::AsmeB18_2_1),
            ("din 912", Standard::Din912),
            ("din 933", Standard::Din933),
            ("iso 7380", Standard::Iso7380),
            ("astm a307", Standard::AstmA307),
            ("astm a574", Standard::AstmA574),
            ("ifi 111", Standard::Ifi111),
        ],
    )
}

fn lookup_phrase<T: Copy>(text: &str, entries: &[(&'static str, T)]) -> Option<(T, &'static str)> {
    entries
        .iter()
        .filter(|(phrase, _)| contains_phrase(text, phrase))
        .max_by_key(|(phrase, _)| phrase.len())
        .map(|(phrase, value)| (*value, *phrase))
}

fn contains_phrase(text: &str, phrase: &str) -> bool {
    let padded = format!(" {text} ");
    let needle = format!(" {phrase} ");
    padded.contains(&needle)
}

fn mark_match(text: &str, phrase: &str, consumed: &mut HashSet<String>) {
    let _ = text;
    for token in tokens(phrase) {
        consumed.insert(token);
    }
}

pub fn thread_matches(query: &AttrSpec, candidate: &AttrSpec) -> bool {
    match (&query.thread_spec, &candidate.thread_spec) {
        (Some(q), Some(c)) => {
            q == c
                || c.starts_with(&format!("{q}-"))
                || q.starts_with(&format!("{c}-"))
                || (query.thread_size_normalized.is_some()
                    && candidate.thread_size_normalized.is_some()
                    && (query.thread_size_normalized.unwrap()
                        - candidate.thread_size_normalized.unwrap())
                    .abs()
                        < 0.05)
        }
        _ => false,
    }
}

fn trim_number(input: &str) -> String {
    if let Some(stripped) = input.strip_suffix(".0") {
        stripped.to_string()
    } else {
        input.to_string()
    }
}

fn numbered_screw_mm(size: &str) -> Option<f32> {
    match size {
        "4" => Some(2.84),
        "6" => Some(3.51),
        "8" => Some(4.17),
        "10" => Some(4.83),
        "12" => Some(5.49),
        _ => None,
    }
}

fn fraction_to_mm(value: &str) -> Option<f32> {
    let (num, den) = value.split_once('/')?;
    let num = num.parse::<f32>().ok()?;
    let den = den.parse::<f32>().ok()?;
    Some(num / den * 25.4)
}

fn imperial_len_to_mm(value: &str) -> Option<f32> {
    if let Some((whole, frac)) = value.split_once('-') {
        let whole = whole.parse::<f32>().ok()?;
        Some((whole + fraction_to_float(frac)?) * 25.4)
    } else if value.contains('/') {
        Some(fraction_to_float(value)? * 25.4)
    } else {
        Some(value.parse::<f32>().ok()? * 25.4)
    }
}

fn fraction_to_float(value: &str) -> Option<f32> {
    let (num, den) = value.split_once('/')?;
    Some(num.parse::<f32>().ok()? / den.parse::<f32>().ok()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{load_catalog, ProductType};
    use std::path::PathBuf;

    fn fixture(name: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../data")
            .join(name)
    }

    #[test]
    fn parses_example_queries() {
        let cases = [
            ("M8 flat washer", ProductType::FlatWasher, true),
            (
                "the same washers as last time",
                ProductType::FlatWasher,
                false,
            ),
            ("SHCS 7/16 x 2-1/2", ProductType::SocketHeadCapScrew, true),
            ("HHB 3/4-10 x 5/8", ProductType::HexHeadBolt, true),
            ("M8 x 50mm BHCS", ProductType::ButtonSocketCapScrew, true),
            (
                "7/16-14 phillips pan machine screw 1-1/4",
                ProductType::PhillipsPanMachineScrew,
                true,
            ),
        ];

        for (query, expected_type, require_thread) in cases {
            let parsed = parse_query(query);
            assert_eq!(parsed.product_type, Some(expected_type), "{query}");
            if require_thread {
                assert!(parsed.thread_spec.is_some(), "{query}");
            }
        }
    }

    #[test]
    fn parses_catalog_with_useful_coverage() {
        let catalog = load_catalog(&fixture("catalog.csv")).unwrap();
        let strong = catalog
            .iter()
            .filter(|row| parse_catalog_row(&row.description).extraction_confidence >= 0.5)
            .count();
        assert!(strong >= 950, "only {strong} rows parsed strongly");
    }
}
