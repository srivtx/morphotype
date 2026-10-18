//! Deterministic seeded gradient noise (no global state, identical on every platform).

#[inline]
fn hash(x: i32, y: i32, seed: u32) -> u32 {
    let mut h = (x as u32).wrapping_mul(0x8da6_b343) ^ (y as u32).wrapping_mul(0xd816_3841) ^ seed.wrapping_mul(0xcb1a_b31f);
    h ^= h >> 15;
    h = h.wrapping_mul(0x2c1b_3c6d);
    h ^= h >> 12;
    h = h.wrapping_mul(0x297a_2d39);
    h ^ (h >> 15)
}

#[inline]
fn grad(h: u32, dx: f64, dy: f64) -> f64 {
    let a = (h & 0xffff) as f64 * (std::f64::consts::TAU / 65536.0);
    a.cos() * dx + a.sin() * dy
}

#[inline]
fn fade(t: f64) -> f64 {
    t * t * t * (t * (t * 6.0 - 15.0) + 10.0)
}

/// 2D gradient noise in roughly [-1, 1].
pub fn noise2(x: f64, y: f64, seed: u32) -> f64 {
    let xi = x.floor();
    let yi = y.floor();
    let (fx, fy) = (x - xi, y - yi);
    let (ix, iy) = (xi as i32, yi as i32);
    let n00 = grad(hash(ix, iy, seed), fx, fy);
    let n10 = grad(hash(ix + 1, iy, seed), fx - 1.0, fy);
    let n01 = grad(hash(ix, iy + 1, seed), fx, fy - 1.0);
    let n11 = grad(hash(ix + 1, iy + 1, seed), fx - 1.0, fy - 1.0);
    let u = fade(fx);
    let v = fade(fy);
    let a = n00 + (n10 - n00) * u;
    let b = n01 + (n11 - n01) * u;
    (a + (b - a) * v) * 1.414
}

/// Fractal sum of `octaves` noise layers, roughly in [-1, 1].
pub fn fbm(x: f64, y: f64, seed: u32, octaves: u32) -> f64 {
    let mut sum = 0.0;
    let mut amp = 0.5;
    let mut norm = 0.0;
    let (mut fx, mut fy) = (x, y);
    for o in 0..octaves.max(1) {
        sum += amp * noise2(fx, fy, seed.wrapping_add(o * 1013));
        norm += amp;
        amp *= 0.5;
        fx = fx * 2.03 + 17.1;
        fy = fy * 2.03 - 9.7;
    }
    sum / norm
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn deterministic_and_bounded() {
        for i in 0..1000 {
            let x = i as f64 * 0.137;
            let a = fbm(x, x * 0.7, 7, 4);
            assert_eq!(a, fbm(x, x * 0.7, 7, 4));
            assert!(a.abs() <= 1.5);
        }
        assert_ne!(noise2(0.3, 0.4, 1), noise2(0.3, 0.4, 2));
    }
}
