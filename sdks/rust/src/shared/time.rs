use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub(crate) fn format(time: SystemTime) -> String {
    let since = time.duration_since(UNIX_EPOCH).unwrap_or_default();
    let seconds = since.as_secs() as i64;
    let (year, month, day) = civil(seconds.div_euclid(86_400));
    let clock = seconds.rem_euclid(86_400);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z",
        clock / 3600,
        clock / 60 % 60,
        clock % 60,
        since.subsec_millis()
    )
}

pub(crate) fn parse(text: &str) -> Option<SystemTime> {
    let number = |range: std::ops::Range<usize>| text.get(range)?.parse::<i64>().ok();
    let days = days(number(0..4)?, number(5..7)?, number(8..10)?);
    let clock = number(11..13)? * 3600 + number(14..16)? * 60 + number(17..19)?;
    let rest = text.get(19..)?;
    let digits = rest
        .strip_prefix('.')
        .map(|tail| tail.bytes().take_while(u8::is_ascii_digit).count())
        .unwrap_or(0);
    let nanos = match digits {
        0 => 0,
        n => format!("{:0<9}", &rest[1..=n.min(9)]).parse::<u32>().ok()?,
    };
    let zone = &rest[if digits > 0 { digits + 1 } else { 0 }..];
    let offset = match zone {
        "Z" | "z" | "" => 0,
        _ => {
            let sign = if zone.starts_with('-') { -1 } else { 1 };
            let hours: i64 = zone.get(1..3)?.parse().ok()?;
            let minutes: i64 = zone.get(4..6)?.parse().ok()?;
            sign * (hours * 3600 + minutes * 60)
        }
    };
    let seconds = u64::try_from(days * 86_400 + clock - offset).ok()?;
    Some(UNIX_EPOCH + Duration::new(seconds, nanos))
}

fn days(year: i64, month: i64, day: i64) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = year.div_euclid(400);
    let of_era = year - era * 400;
    let of_year = (153 * ((month + 9) % 12) + 2) / 5 + day - 1;
    let of_cycle = of_era * 365 + of_era / 4 - of_era / 100 + of_year;
    era * 146_097 + of_cycle - 719_468
}

fn civil(days: i64) -> (i64, i64, i64) {
    let days = days + 719_468;
    let era = days.div_euclid(146_097);
    let of_era = days - era * 146_097;
    let of_cycle = (of_era - of_era / 1460 + of_era / 36_524 - of_era / 146_096) / 365;
    let of_year = of_era - (365 * of_cycle + of_cycle / 4 - of_cycle / 100);
    let shifted = (5 * of_year + 2) / 153;
    let day = of_year - (153 * shifted + 2) / 5 + 1;
    let month = if shifted < 10 {
        shifted + 3
    } else {
        shifted - 9
    };
    let year = of_cycle + era * 400 + i64::from(month <= 2);
    (year, month, day)
}
