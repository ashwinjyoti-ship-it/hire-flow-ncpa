type BrandLogoProps = {
  className?: string;
  alt?: string;
};

export function BrandLogo({ className = "", alt = "NCPA Venue for Hire logo" }: BrandLogoProps) {
  const classes = ["block h-auto w-full object-contain", className].filter(Boolean).join(" ");

  return <img src="/venue-hire-logo.svg" alt={alt} className={classes} />;
}
