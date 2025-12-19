-- CreateTable
CREATE TABLE "Hospital" (
    "id" TEXT NOT NULL,
    "hospital_name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "zip_code" TEXT NOT NULL,
    "county_name" TEXT NOT NULL,
    "phone_number" TEXT NOT NULL,
    "hospital_type" TEXT,
    "hospital_ownership" TEXT,
    "emergency_services" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Hospital_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Snf" (
    "ccn" TEXT NOT NULL,
    "facility_name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "zip_code" TEXT NOT NULL,
    "county_name" TEXT NOT NULL,
    "phone_number" TEXT NOT NULL,
    "ownership_type" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "composite_score" DOUBLE PRECISION,
    "overall_rating" DOUBLE PRECISION,
    "health_inspection_rating" DOUBLE PRECISION,
    "staffing_rating" DOUBLE PRECISION,
    "qm_rating" DOUBLE PRECISION,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Snf_pkey" PRIMARY KEY ("ccn")
);

-- CreateTable
CREATE TABLE "GeocodeCache" (
    "key" TEXT NOT NULL,
    "lat" DOUBLE PRECISION,
    "lon" DOUBLE PRECISION,
    "provider" TEXT,
    "payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GeocodeCache_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "GooglePlaceCache" (
    "key" TEXT NOT NULL,
    "place_id" TEXT,
    "name" TEXT,
    "formatted_address" TEXT,
    "location" JSONB,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GooglePlaceCache_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "GoogleReviewsSnapshot" (
    "place_id" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "fetched_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoogleReviewsSnapshot_pkey" PRIMARY KEY ("place_id")
);
