use anyhow::Result;
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use std::{fmt, path::Path, str::FromStr};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CatalogRow {
    pub catalog_id: String,
    pub sku: String,
    #[serde(rename = "catalog_description")]
    pub description: String,
    #[serde(deserialize_with = "deserialize_active")]
    pub active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct OrderRow {
    pub customer_id: String,
    pub customer_name: String,
    pub order_date: NaiveDate,
    pub sku: String,
    #[serde(rename = "catalog_description")]
    pub catalog_description: String,
    pub quantity: u32,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize, PartialEq)]
pub struct AttrSpec {
    pub thread_spec: Option<String>,
    pub thread_size_normalized: Option<f32>,
    pub length_mm: Option<f32>,
    pub length_raw: Option<String>,
    pub product_type: Option<ProductType>,
    pub material: Option<Material>,
    pub finish: Option<Finish>,
    pub standard: Option<Standard>,
    pub extraction_confidence: f32,
    pub raw_tokens_unconsumed: Vec<String>,
}

macro_rules! enum_with_display {
    ($name:ident { $($variant:ident => $value:literal),+ $(,)? }) => {
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
        pub enum $name {
            $($variant),+
        }

        impl $name {
            pub fn as_str(self) -> &'static str {
                match self {
                    $(Self::$variant => $value),+
                }
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str(self.as_str())
            }
        }

        impl FromStr for $name {
            type Err = String;

            fn from_str(s: &str) -> std::result::Result<Self, Self::Err> {
                let needle = s.trim().to_ascii_lowercase().replace('_', "-");
                match needle.as_str() {
                    $($value => Ok(Self::$variant),)+
                    _ => Err(format!("unknown {}: {s}", stringify!($name))),
                }
            }
        }
    };
}

enum_with_display!(ProductType {
    HexCapScrew => "hex-cap-screw",
    SocketHeadCapScrew => "socket-head-cap-screw",
    ButtonSocketCapScrew => "button-socket-cap-screw",
    FlatHeadCapScrew => "flat-head-cap-screw",
    HexNut => "hex-nut",
    FlatWasher => "flat-washer",
    LockWasher => "lock-washer",
    ThreadedRod => "threaded-rod",
    LagScrew => "lag-screw",
    TapBolt => "tap-bolt",
    PhillipsPanMachineScrew => "phillips-pan-machine-screw",
    HexHeadBolt => "hex-head-bolt",
});

enum_with_display!(Material {
    Steel => "steel",
    Brass => "brass",
    Alloy => "alloy",
    StainlessSteel18_8 => "18-8-stainless-steel",
    StainlessSteel316 => "316-stainless-steel",
    StainlessSteelA2 => "a2-stainless-steel",
});

enum_with_display!(Finish {
    Zinc => "zinc",
    YellowZinc => "yellow-zinc",
    MechanicalZinc => "mechanical-zinc",
    BlackOxide => "black-oxide",
    HotDipGalvanized => "hot-dip-galvanized",
    Plain => "plain",
});

enum_with_display!(Standard {
    AsmeB18_2_1 => "asme-b18.2.1",
    Din912 => "din-912",
    Din933 => "din-933",
    Iso7380 => "iso-7380",
    AstmA307 => "astm-a307",
    AstmA574 => "astm-a574",
    Ifi111 => "ifi-111",
});

pub fn load_catalog(path: &Path) -> Result<Vec<CatalogRow>> {
    let mut rdr = csv::Reader::from_path(path)?;
    rdr.deserialize()
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(Into::into)
}

pub fn load_orders(path: &Path) -> Result<Vec<OrderRow>> {
    let mut rdr = csv::Reader::from_path(path)?;
    rdr.deserialize()
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(Into::into)
}

fn deserialize_active<'de, D>(deserializer: D) -> std::result::Result<bool, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = String::deserialize(deserializer)?;
    Ok(matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "y" | "yes" | "true" | "1" | "active"
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn fixture(name: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../data")
            .join(name)
    }

    #[test]
    fn loads_catalog() {
        let rows = load_catalog(&fixture("catalog.csv")).unwrap();
        assert_eq!(rows.len(), 1000);
        assert_eq!(rows[0].sku, "PXLAG38112STHG0001");
    }

    #[test]
    fn loads_orders() {
        let rows = load_orders(&fixture("order_history.csv")).unwrap();
        assert_eq!(rows.len(), 76);
        assert_eq!(rows[0].customer_id, "CUST-001");
    }
}
